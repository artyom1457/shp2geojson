/*
 * Inspired by the shp.js , dbf.js by Mano Marks
 *
 * I found there were something wrong to show chinese characters from DBF file,
 * so i added some code that is needed to deal with this problem.
 *
 * Created by Gipong <sheu781230@gmail.com>
 *
 */

// Shapefile parser, following the specification at
// http://www.esri.com/library/whitepapers/pdfs/shapefile.pdf
enum SHP {
  NULL = 0,
  POINT = 1,
  POLYLINE = 3,
  POLYGON = 5,
  MULTIPOINT = 8,
}

export enum NotSupportedShapeType {
  PointZ = 11,
  PolylineZ = 13,
  PolygonZ = 15,
  MultiPointZ = 18,
  PointM = 21,
  PolylineM = 23,
  PolygonM = 25,
  MultiPointM = 28,
  MultiPatch = 31,
}
type SHPShape =
  | { type: typeof SHP.NULL; content: undefined }
  | { type: typeof SHP.POINT; content: { x: number; y: number } }
  | {
      type: typeof SHP.POLYLINE | typeof SHP.POLYGON | typeof SHP.MULTIPOINT;
      content: {
        minX: number;
        minY: number;
        maxX: number;
        maxY: number;
        parts: Int32Array;
        points: Float64Array;
      };
    };

type SHPRecord = {
  number: number;
  length: number;
  shape: SHPShape;
};

export type SHPFile = {
  fileName: string;
  fileCode: number;
  wordLength: number;
  byteLength: number;
  version: number;
  shapeType: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  minZ: number;
  maxZ: number;
  minM: number;
  maxM: number;
  records: SHPRecord[];
};

export type DBFFile = {
  fileName: string;
  version: number;
  year: number;
  month: number;
  day: number;
  numberOfRecords: number;
  bytesInHeader: number;
  bytesInRecord: number;
  incompleteTransation: number;
  encryptionFlag: number;
  mdxFlag: number;
  languageDriverId: number;
  fields: DBFField[];
  fieldpos: number;
  records: any[];
};

type DBFField = {
  name: string;
  type: string;
  fieldLength: number;
  workAreaId: number;
  setFieldFlag: number;
  indexFieldFlag: number;
};

class SHPParser {
  static async load(url: string) {
    try {
      const response = await fetch(url);
      const arrayBuffer = await response.arrayBuffer();
      const parsed = SHPParser.parse(arrayBuffer, url);

      URL.revokeObjectURL(url);
      return parsed;
    } catch (error: any) {
      URL.revokeObjectURL(url); // Ensure cleanup even on error
      throw new Error(`Failed to load SHP:\n  ↳ ${error.message}`);
    }
  }

  static parse(arrayBuffer: ArrayBuffer, url: string): SHPFile {
    const dv = new DataView(arrayBuffer);
    let idx = 0;

    // ─── File Header ─────────────────────────────────────────────
    const fileCode = dv.getInt32(idx, false);
    if (fileCode !== 0x0000270a) {
      throw new Error(`Unknown file code: ${fileCode}`);
    }

    idx += 24; // Skip unused bytes (5 ints)

    const wordLength = dv.getInt32(idx, false);
    const byteLength = wordLength * 2;
    idx += 4;

    const version = dv.getInt32(idx, true);
    idx += 4;

    const shapeType = dv.getInt32(idx, true);
    idx += 4;

    const minX = dv.getFloat64(idx, true);
    const minY = dv.getFloat64(idx + 8, true);
    const maxX = dv.getFloat64(idx + 16, true);
    const maxY = dv.getFloat64(idx + 24, true);
    const minZ = dv.getFloat64(idx + 32, true);
    const maxZ = dv.getFloat64(idx + 40, true);
    const minM = dv.getFloat64(idx + 48, true);
    const maxM = dv.getFloat64(idx + 56, true);

    idx += 64; // Move past bounding box (8 floats × 8 bytes)

    // ─── Initialize SHPFile ─────────────────────────────────────
    const shpFile: SHPFile = {
      fileName: url,
      fileCode,
      wordLength,
      byteLength,
      version,
      shapeType,
      minX,
      minY,
      maxX,
      maxY,
      minZ,
      maxZ,
      minM,
      maxM,
      records: [],
    };

    // ─── Parse Records ──────────────────────────────────────────
    while (idx < byteLength) {
      const number = dv.getInt32(idx, false);
      idx += 4;

      const length = dv.getInt32(idx, false);
      idx += 4;

      let shape: SHPShape;
      try {
        shape = this.parseShape(dv, idx, length);
      } catch (e: any) {
        throw new Error(`Shape parsing error: ${e.message} (record ${number})`);
      }

      idx += length * 2;

      shpFile.records.push({
        number,
        length,
        shape,
      });
    }

    return shpFile;
  }

  static parseShape(dv: DataView, idx: number, length: number): SHPShape {
    const shapeType = dv.getInt32(idx, true);
    idx += 4;

    switch (shapeType) {
      case SHP.NULL:
        return {
          type: SHP.NULL,
          content: undefined,
        };

      case SHP.POINT:
        return {
          type: SHP.POINT,
          content: {
            x: dv.getFloat64(idx, true),
            y: dv.getFloat64(idx + 8, true),
          },
        };

      case SHP.MULTIPOINT:
      case SHP.POLYLINE:
      case SHP.POLYGON: {
        const minX = dv.getFloat64(idx, true);
        const minY = dv.getFloat64(idx + 8, true);
        const maxX = dv.getFloat64(idx + 16, true);
        const maxY = dv.getFloat64(idx + 24, true);
        const partCount = dv.getInt32(idx + 32, true);
        const pointCount = dv.getInt32(idx + 36, true);

        idx += 40;

        const parts = new Int32Array(partCount);
        for (let i = 0; i < partCount; i++) {
          parts[i] = dv.getInt32(idx, true);
          idx += 4;
        }

        const points = new Float64Array(pointCount * 2);
        for (let i = 0; i < points.length; i++) {
          points[i] = dv.getFloat64(idx, true);
          idx += 8;
        }

        return {
          type: shapeType, // safe because shapeType is narrowed to POLYLINE or POLYGON
          content: { minX, minY, maxX, maxY, parts, points },
        };
      }

      // Unsupported shape types from the enum
      case NotSupportedShapeType.PointZ:
      case NotSupportedShapeType.PolylineZ:
      case NotSupportedShapeType.PolygonZ:
      case NotSupportedShapeType.MultiPointZ:
      case NotSupportedShapeType.PointM:
      case NotSupportedShapeType.PolylineM:
      case NotSupportedShapeType.PolygonM:
      case NotSupportedShapeType.MultiPointM:
      case NotSupportedShapeType.MultiPatch:
        throw new Error(
          `Shape type not supported: ${shapeType} (${
            NotSupportedShapeType[shapeType] ?? "Unknown"
          })`
        );

      default:
        throw new Error(`Unknown shape type at ${idx - 4}: ${shapeType}\n`);
    }
  }
}

/**
 * @fileoverview Parses a .dbf file based on the xbase standards as documented
 * here: http://www.clicketyclick.dk/databases/xbase/format/dbf.html
 * @author Mano Marks
 */

// Creates global namespace.

class DBFParser {
  static async load(url: string, encoding: string): Promise<DBFFile> {
    try {
      // Fetch binary data
      const binaryResponse = await fetch(url);
      if (!binaryResponse.ok) {
        throw new Error(`Failed to load binary data from ${url}`);
      }
      const binaryData = await binaryResponse.arrayBuffer();

      // Fetch text data with specific encoding
      const textResponse = await fetch(url, {
        headers: {
          Accept: "text/plain",
        },
      });

      const decoder = new TextDecoder(encoding);
      const textBuffer = await textResponse.arrayBuffer();
      const textData = decoder.decode(textBuffer);

      // Parse DBF file using parser
      const parsed = DBFParser.parse(binaryData, url, textData, encoding);

      URL.revokeObjectURL(url);

      return parsed;
    } catch (error) {
      console.error("Error loading DBF file:", error);
      throw error;
    }
  }

  static parse(
    arrayBuffer: ArrayBuffer,
    src: string,
    response: string,
    encoding: string
  ): DBFFile {
    const dv = new DataView(arrayBuffer);
    let idx = 0;
    let offset = /big5/i.test(encoding) ? 2 : 3;

    // ─── Initialize DBF Header ──────────────────────────────
    const dbf: DBFFile = {
      fileName: src,
      version: dv.getInt8(idx),
      year: 0,
      month: 0,
      day: 0,
      numberOfRecords: 0,
      bytesInHeader: 0,
      bytesInRecord: 0,
      incompleteTransation: 0,
      encryptionFlag: 0,
      mdxFlag: 0,
      languageDriverId: 0,
      fields: [],
      fieldpos: 0,
      records: [],
    };

    idx++;
    dbf.year = dv.getUint8(idx++) + 1900;
    dbf.month = dv.getUint8(idx++);
    dbf.day = dv.getUint8(idx++);
    dbf.numberOfRecords = dv.getInt32(idx, true);
    idx += 4;
    dbf.bytesInHeader = dv.getInt16(idx, true);
    idx += 2;
    dbf.bytesInRecord = dv.getInt16(idx, true);
    idx += 2;

    idx += 2; // reserved
    dbf.incompleteTransation = dv.getUint8(idx++);
    dbf.encryptionFlag = dv.getUint8(idx++);
    idx += 4; // skip free record thread
    idx += 8; // reserved
    dbf.mdxFlag = dv.getUint8(idx++);
    dbf.languageDriverId = dv.getUint8(idx++);
    idx += 2; // reserved

    // ─── Prepare Response Header (Field Names) ───────────────
    const responseParts = response.split("\r");
    let responseHeader = "";

    if (responseParts.length > 2) {
      responseParts.pop();
      responseHeader = responseParts.join("\r").slice(32);
    } else {
      responseHeader = responseParts[0].slice(32);
      offset = 2;
    }

    // ─── Parse Field Names from Header ───────────────────────
    const charString: string[] = [];
    while (responseHeader.length > 0) {
      let z = 0;
      let count = 0;

      while (count < 10) {
        try {
          const enc = encodeURIComponent(responseHeader[z]);
          const match = enc.match(/%[A-F\d]{2}/g);
          count += match && match.length > 1 ? offset : 1;
          z++;
        } catch {
          count++;
          z++;
        }
      }

      charString.push(responseHeader.slice(0, 10).replace(/\0/g, ""));
      responseHeader = responseHeader.slice(32);
    }

    // ─── Parse Field Metadata ────────────────────────────────
    let nameIndex = 0;

    while (true) {
      const nameArray: string[] = [];

      for (let i = 0; i < 10; i++) {
        const byte = dv.getUint8(idx++);
        if (byte !== 0) nameArray.push(String.fromCharCode(byte));
      }

      const field: DBFField = {
        name: charString[nameIndex++],
        type: "",
        fieldLength: 0,
        workAreaId: 0,
        setFieldFlag: 0,
        indexFieldFlag: 0,
      };

      idx++; // Reserved
      field.type = String.fromCharCode(dv.getUint8(idx++));
      idx += 4; // Field data address
      field.fieldLength = dv.getUint8(idx++);
      idx++; // Decimal count
      idx += 2; // Reserved
      field.workAreaId = dv.getUint8(idx++);
      idx += 2; // Reserved
      field.setFieldFlag = dv.getUint8(idx++);
      idx += 7; // Reserved
      field.indexFieldFlag = dv.getUint8(idx++);

      dbf.fields.push(field);

      // 0x0D indicates end of field descriptor
      if (dv.getUint8(idx) === 0x0d) break;
    }

    idx++; // Skip field terminator
    dbf.fieldpos = idx;

    // ─── Parse Records ───────────────────────────────────────
    const responseTextRaw = response.split("\r").at(-1) || "";
    let responseText = responseTextRaw;

    for (let i = 0; i < dbf.numberOfRecords; i++) {
      responseText = responseText.slice(1); // Skip deletion flag
      const record: Record<string, string | number> = {};

      for (const field of dbf.fields) {
        let z = 0;
        let count = 0;

        while (count < field.fieldLength) {
          try {
            const enc = encodeURIComponent(responseHeader[z]);
            const match = enc.match(/%[A-F\d]{2}/g);
            count += match && match.length > 1 ? offset : 1;
            z++;
          } catch {
            count++;
            z++;
          }
        }

        const rawValue = responseText.slice(0, z).replace(/\0/g, "").trim();
        responseText = responseText.slice(z);

        // Detect and convert scientific notation numbers
        if (/^\d\.\d{11}e\+\d{3}$/i.test(rawValue)) {
          record[field.name] = parseFloat(rawValue);
        } else {
          record[field.name] = rawValue;
        }
      }

      dbf.records.push(record);
    }

    return dbf;
  }
}

// Export the classes as a module
export { SHPParser, DBFParser };
