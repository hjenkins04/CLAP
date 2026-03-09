import type {
  FlattenedEdits,
  PointDiff,
  PointId,
  EditJournalState,
  EditOperation,
} from './types';

// --- edits.bin: Flattened state ---

const EDITS_MAGIC = 0x45504c43; // "CLPE" in little-endian
const EDITS_VERSION = 1;
const HEADER_SIZE = 32;
const TRANSFORM_SIZE = 128; // 16 * float64
const MAX_POINT_ID_LEN = 32;
const POINT_RECORD_SIZE = MAX_POINT_ID_LEN + 4; // id + flags(1) + class(1) + intensity(2)

export function serializeFlattened(edits: FlattenedEdits): ArrayBuffer {
  const pointCount = edits.pointEdits.size;
  const totalSize =
    HEADER_SIZE + TRANSFORM_SIZE + pointCount * POINT_RECORD_SIZE;
  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  // Header
  view.setUint32(0, EDITS_MAGIC, true);
  view.setUint16(4, EDITS_VERSION, true);
  view.setUint16(6, 0, true); // flags
  view.setUint32(8, pointCount, true);
  view.setUint32(12, MAX_POINT_ID_LEN, true);

  // Global transform
  const transformView = new Float64Array(buffer, HEADER_SIZE, 16);
  transformView.set(edits.globalTransform);

  // Point edit records
  const encoder = new TextEncoder();
  let offset = HEADER_SIZE + TRANSFORM_SIZE;

  for (const [id, diff] of edits.pointEdits) {
    // Write point ID (null-padded fixed width)
    const idBytes = encoder.encode(id as string);
    bytes.set(idBytes.subarray(0, MAX_POINT_ID_LEN), offset);

    // Flags
    let flags = 0;
    if (diff.classification !== undefined) flags |= 0x01;
    if (diff.intensity !== undefined) flags |= 0x02;
    if (diff.deleted) flags |= 0x04;
    view.setUint8(offset + MAX_POINT_ID_LEN, flags);

    // Classification
    view.setUint8(
      offset + MAX_POINT_ID_LEN + 1,
      diff.classification ?? 0
    );

    // Intensity
    view.setUint16(
      offset + MAX_POINT_ID_LEN + 2,
      diff.intensity ?? 0,
      true
    );

    offset += POINT_RECORD_SIZE;
  }

  return buffer;
}

export function deserializeFlattened(buffer: ArrayBuffer): FlattenedEdits {
  const view = new DataView(buffer);

  const magic = view.getUint32(0, true);
  if (magic !== EDITS_MAGIC) {
    throw new Error('Invalid edits.bin: bad magic number');
  }

  const version = view.getUint16(4, true);
  if (version !== EDITS_VERSION) {
    throw new Error(`Unsupported edits.bin version: ${version}`);
  }

  const pointCount = view.getUint32(8, true);
  const idLen = view.getUint32(12, true);
  const recordSize = idLen + 4;

  // Global transform
  const globalTransform = new Float64Array(16);
  globalTransform.set(new Float64Array(buffer, HEADER_SIZE, 16));

  // Point edits
  const decoder = new TextDecoder();
  const pointEdits = new Map<PointId, PointDiff>();
  let offset = HEADER_SIZE + TRANSFORM_SIZE;

  for (let i = 0; i < pointCount; i++) {
    // Read point ID (strip null padding)
    const idRaw = new Uint8Array(buffer, offset, idLen);
    let idEnd = idRaw.indexOf(0);
    if (idEnd === -1) idEnd = idLen;
    const id = decoder.decode(idRaw.subarray(0, idEnd)) as PointId;

    const flags = view.getUint8(offset + idLen);
    const diff: PointDiff = {};

    if (flags & 0x01) {
      diff.classification = view.getUint8(offset + idLen + 1);
    }
    if (flags & 0x02) {
      diff.intensity = view.getUint16(offset + idLen + 2, true);
    }
    if (flags & 0x04) {
      diff.deleted = true;
    }

    pointEdits.set(id, diff);
    offset += recordSize;
  }

  return { globalTransform, pointEdits };
}

// --- edits.journal.bin: Full journal ---

const JOURNAL_MAGIC = 0x4a504c43; // "CLPJ" in little-endian
const JOURNAL_VERSION = 1;
const JOURNAL_HEADER_SIZE = 16;

const OP_TYPE_MAP: Record<string, number> = {
  GlobalTransform: 0,
  SetClassification: 1,
  SetIntensity: 2,
  DeletePoints: 3,
  RestorePoints: 4,
};

const OP_TYPE_REVERSE: Record<number, string> = {
  0: 'GlobalTransform',
  1: 'SetClassification',
  2: 'SetIntensity',
  3: 'DeletePoints',
  4: 'RestorePoints',
};

export function serializeJournal(state: EditJournalState): ArrayBuffer {
  // First pass: calculate total size
  let totalSize = JOURNAL_HEADER_SIZE;
  for (const op of state.operations) {
    totalSize += calcOpSize(op);
  }

  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);

  // Header
  view.setUint32(0, JOURNAL_MAGIC, true);
  view.setUint16(4, JOURNAL_VERSION, true);
  view.setUint16(6, 0, true);
  view.setUint32(8, state.operations.length, true);
  view.setUint32(12, state.cursor, true);

  // Operations
  const encoder = new TextEncoder();
  let offset = JOURNAL_HEADER_SIZE;

  for (const op of state.operations) {
    const opSize = calcOpSize(op);

    // Op header (16 bytes: size + timestamp + type + padding)
    view.setUint32(offset, opSize, true);
    view.setFloat64(offset + 4, op.timestamp, true);
    view.setUint8(offset + 12, OP_TYPE_MAP[op.type]);
    // bytes 13-15 padding

    let payloadOffset = offset + 16;

    switch (op.type) {
      case 'GlobalTransform': {
        const arr = new Float64Array(buffer, payloadOffset, 16);
        for (let i = 0; i < 16; i++) arr[i] = op.matrix[i];
        break;
      }

      case 'SetClassification': {
        view.setUint32(payloadOffset, op.pointIds.length, true);
        view.setUint8(payloadOffset + 4, op.newValue);
        payloadOffset += 8; // 4 + 1 + 3 padding
        writePointIds(
          new Uint8Array(buffer),
          encoder,
          payloadOffset,
          op.pointIds
        );
        payloadOffset += op.pointIds.length * MAX_POINT_ID_LEN;
        for (let i = 0; i < op.previousValues.length; i++) {
          view.setUint8(payloadOffset + i, op.previousValues[i]);
        }
        break;
      }

      case 'SetIntensity': {
        view.setUint32(payloadOffset, op.pointIds.length, true);
        view.setUint16(payloadOffset + 4, op.newValue, true);
        payloadOffset += 8; // 4 + 2 + 2 padding
        writePointIds(
          new Uint8Array(buffer),
          encoder,
          payloadOffset,
          op.pointIds
        );
        payloadOffset += op.pointIds.length * MAX_POINT_ID_LEN;
        for (let i = 0; i < op.previousValues.length; i++) {
          view.setUint16(payloadOffset + i * 2, op.previousValues[i], true);
        }
        break;
      }

      case 'DeletePoints':
      case 'RestorePoints': {
        view.setUint32(payloadOffset, op.pointIds.length, true);
        payloadOffset += 4;
        writePointIds(
          new Uint8Array(buffer),
          encoder,
          payloadOffset,
          op.pointIds
        );
        break;
      }
    }

    offset += opSize;
  }

  return buffer;
}

export function deserializeJournal(buffer: ArrayBuffer): EditJournalState {
  const view = new DataView(buffer);

  const magic = view.getUint32(0, true);
  if (magic !== JOURNAL_MAGIC) {
    throw new Error('Invalid edits.journal.bin: bad magic');
  }

  const opCount = view.getUint32(8, true);
  const cursor = view.getUint32(12, true);

  const decoder = new TextDecoder();
  const operations: EditOperation[] = [];
  let offset = JOURNAL_HEADER_SIZE;

  for (let i = 0; i < opCount; i++) {
    const opSize = view.getUint32(offset, true);
    const timestamp = view.getFloat64(offset + 4, true);
    const typeNum = view.getUint8(offset + 12);
    const type = OP_TYPE_REVERSE[typeNum];
    const id = `op_${i}`;

    let payloadOffset = offset + 16;

    switch (type) {
      case 'GlobalTransform': {
        const matrix: number[] = [];
        const arr = new Float64Array(buffer, payloadOffset, 16);
        for (let j = 0; j < 16; j++) matrix.push(arr[j]);
        operations.push({ id, timestamp, type: 'GlobalTransform', matrix });
        break;
      }

      case 'SetClassification': {
        const count = view.getUint32(payloadOffset, true);
        const newValue = view.getUint8(payloadOffset + 4);
        payloadOffset += 8;
        const pointIds = readPointIds(buffer, decoder, payloadOffset, count);
        payloadOffset += count * MAX_POINT_ID_LEN;
        const previousValues: number[] = [];
        for (let j = 0; j < count; j++) {
          previousValues.push(view.getUint8(payloadOffset + j));
        }
        operations.push({
          id,
          timestamp,
          type: 'SetClassification',
          pointIds,
          previousValues,
          newValue,
        });
        break;
      }

      case 'SetIntensity': {
        const count = view.getUint32(payloadOffset, true);
        const newValue = view.getUint16(payloadOffset + 4, true);
        payloadOffset += 8;
        const pointIds = readPointIds(buffer, decoder, payloadOffset, count);
        payloadOffset += count * MAX_POINT_ID_LEN;
        const previousValues: number[] = [];
        for (let j = 0; j < count; j++) {
          previousValues.push(view.getUint16(payloadOffset + j * 2, true));
        }
        operations.push({
          id,
          timestamp,
          type: 'SetIntensity',
          pointIds,
          previousValues,
          newValue,
        });
        break;
      }

      case 'DeletePoints':
      case 'RestorePoints': {
        const count = view.getUint32(payloadOffset, true);
        payloadOffset += 4;
        const pointIds = readPointIds(buffer, decoder, payloadOffset, count);
        operations.push({
          id,
          timestamp,
          type: type as 'DeletePoints' | 'RestorePoints',
          pointIds,
        });
        break;
      }
    }

    offset += opSize;
  }

  return { operations, cursor };
}

// --- Helpers ---

function writePointIds(
  bytes: Uint8Array,
  encoder: TextEncoder,
  offset: number,
  ids: readonly string[]
): void {
  for (let i = 0; i < ids.length; i++) {
    const encoded = encoder.encode(ids[i]);
    bytes.set(encoded.subarray(0, MAX_POINT_ID_LEN), offset + i * MAX_POINT_ID_LEN);
  }
}

function readPointIds(
  buffer: ArrayBuffer,
  decoder: TextDecoder,
  offset: number,
  count: number
): PointId[] {
  const ids: PointId[] = [];
  for (let i = 0; i < count; i++) {
    const raw = new Uint8Array(buffer, offset + i * MAX_POINT_ID_LEN, MAX_POINT_ID_LEN);
    let end = raw.indexOf(0);
    if (end === -1) end = MAX_POINT_ID_LEN;
    ids.push(decoder.decode(raw.subarray(0, end)) as PointId);
  }
  return ids;
}

function calcOpSize(op: EditOperation): number {
  const headerSize = 16;
  switch (op.type) {
    case 'GlobalTransform':
      return headerSize + 128; // 16 * float64
    case 'SetClassification':
      return (
        headerSize +
        8 + // count(4) + newValue(1) + padding(3)
        op.pointIds.length * MAX_POINT_ID_LEN +
        op.previousValues.length * 1
      );
    case 'SetIntensity':
      return (
        headerSize +
        8 + // count(4) + newValue(2) + padding(2)
        op.pointIds.length * MAX_POINT_ID_LEN +
        op.previousValues.length * 2
      );
    case 'DeletePoints':
    case 'RestorePoints':
      return headerSize + 4 + op.pointIds.length * MAX_POINT_ID_LEN;
  }
}
