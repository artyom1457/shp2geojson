/*
 * predefined [EPSG:3821] projection
 * Please make sure your desired projection can find on http://epsg.io/
 *
 * Usage :
 *      loadshp({
 *          url: '/shp/test.zip', // path or your upload file
 *          encoding: 'big5' // default utf-8
 *          EPSG: 3826 // default 4326
 *      }, function(geojson) {
 *          // geojson returned
 *      });
 *
 * Created by Gipong <sheu781230@gmail.com>
 *
 */

import { SHPParser, DBFParser } from "./preprocess";
import proj4 from "proj4";
import * as JSZip from "jszip";
import JSZipUtils from "jszip-utils";
import { SHPFile, DBFFile } from "./preprocess";
import { Feature, FeatureCollection, GeoJsonObject, Position } from "geojson";

const EPSG4326 = proj4("EPSG:4326");

type GlobalShp = {
  shp: SHPFile | null;
  dbf: DBFFile | null;
};

let inputData: GlobalShp = {
  shp: null,
  dbf: null,
};

let EPSGUser: proj4.Converter;

export interface ShpConfig {
  url: string | File;
  encoding?: string;
  EPSG?: number;
}

export async function loadshp(config: ShpConfig): Promise<FeatureCollection> {
  const { url, encoding = "utf-8", EPSG = 4326 } = config;

  // await loadEPSG(epsgUrl);

  // if (EPSG === 3821) {
  //   proj4.defs(
  //     "EPSG:3821",
  //     "+proj=tmerc +ellps=GRS67 +towgs84=-752,-358,-179,-.0000011698,.0000018398,.0000009822,.00002329 +lat_0=0 +lon_0=121 +x_0=250000 +y_0=0 +k=0.9999 +units=m +no_defs"
  //   );
  // }

  proj4.defs("EPSG:4326", "+proj=longlat +datum=WGS84 +no_defs +type=crs");
  EPSGUser = proj4(`EPSG:4326`);

  let zip: JSZip;

  if (typeof url !== "string") {
    // File input
    const arrayBuffer = await readFileAsArrayBuffer(url);
    zip = await JSZip.loadAsync(arrayBuffer);
  } else {
    // URL input
    const data = await getBinaryContentAsync(url);
    zip = await JSZip.loadAsync(data);
  }

  const shpFile = zip.file(/\.shp$/i)?.[0];
  const dbfFile = zip.file(/\.dbf$/i)?.[0];
  const prjFile = zip.file(/\.prj$/i)?.[0];

  if (!shpFile || !dbfFile) {
    throw new Error(" ↳ Missing .shp or .dbf file in the ZIP archive.");
  }

  if (prjFile) {
    const prjText = await prjFile.async("string");
    proj4.defs("EPSGUSER", prjText);

    try {
      EPSGUser = proj4("EPSGUSER");
    } catch (e: any) {
      throw new Error(`Unsupported Projection:\n↳ ${e.message}`);
    }
  }

  const shpBuffer = await zip.file(shpFile.name)!.async("arraybuffer");
  const shp = await SHPParser.load(URL.createObjectURL(new Blob([shpBuffer])));

  const dbfBuffer = await zip.file(dbfFile.name)!.async("arraybuffer");
  const dbf = await DBFParser.load(
    URL.createObjectURL(new Blob([dbfBuffer])),
    encoding
  );

  return toGeojson({ shp, dbf });
}

function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = reject;

    reader.readAsArrayBuffer(file);
  });
}

function getBinaryContentAsync(url: string): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    JSZipUtils.getBinaryContent(url, (err, data) => {
      if (err) reject(err);
      else resolve(data);
    });
  });
}

// function loadEPSG(url: string): Promise<void> {
//   return new Promise((resolve, reject) => {
//     const script = document.createElement("script");
//     script.src = url;
//     script.onload = () => resolve();
//     script.onerror = () => reject(new Error(`Failed to load script: ${url}`));
//     document.head.appendChild(script);
//   });
// }

function TransCoord(x: number, y: number) {
  if (!proj4) {
    throw new Error("proj4 is not available");
  }

  const [lon, lat] = proj4(EPSGUser, EPSG4326, [x, y]);
  return { x: lon, y: lat };
}

function toGeojson({
  shp,
  dbf,
}: {
  shp: SHPFile;
  dbf: DBFFile;
}): FeatureCollection {
  const geojson: FeatureCollection = {
    type: "FeatureCollection",
    bbox: [
      TransCoord(shp.minX, shp.minY).x,
      TransCoord(shp.minX, shp.minY).y,
      TransCoord(shp.maxX, shp.maxY).x,
      TransCoord(shp.maxX, shp.maxY).y,
    ],
    features: [],
  };

  shp.records.forEach((shpRecord, i) => {
    const shape = shpRecord.shape;
    const { type, content } = shape;

    const feature: Feature = {
      type: "Feature",
      geometry: { type: "Point", coordinates: [0, 0] }, // will be overridden
      properties: dbf.records[i],
    };

    switch (type) {
      case 1: {
        // Point
        const { x, y } = TransCoord(content.x, content.y);
        feature.geometry = {
          type: "Point",
          coordinates: [x, y],
        };
        break;
      }

      case 3: // Polyline
      case 8: {
        // MultiPoint
        const coordinates: Position[] = [];

        for (let j = 0; j < content.points.length; j += 2) {
          const { x, y } = TransCoord(content.points[j], content.points[j + 1]);
          coordinates.push([x, y]);
        }

        feature.geometry = {
          type: type === 3 ? "LineString" : "MultiPoint",
          coordinates,
        };
        break;
      }

      case 5: {
        // Polygon
        const coordinates: Position[][] = [];

        const points = content.points;
        const parts = content.parts;

        for (let p = 0; p < parts.length; p++) {
          const start = parts[p] * 2;
          const end = (parts[p + 1] || points.length / 2) * 2;
          const ring: Position[] = [];

          for (let j = start; j < end; j += 2) {
            const { x, y } = TransCoord(points[j], points[j + 1]);
            ring.push([x, y]);
          }

          coordinates.push(ring);
        }

        feature.geometry = {
          type: "Polygon",
          coordinates,
        };
        break;
      }

      default:
        throw new Error(`Unsupported shape type: ${type}`);
    }

    geojson.features.push(feature);
  });

  return geojson;
}
