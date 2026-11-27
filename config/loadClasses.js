/**
 * Van load options. These are labeling load classes, never standard-item classes.
 * The full-load option's catalogue name is "Full Load / Large Load".
 */
const LOAD_SIZES = [
  'Mini Load',
  '1/4 Load',
  '1/2 Load',
  '3/4 Load',
  'Full Load / Large Load',
];

const LEGACY_FULL_LOAD_CLASS = 'Full Load';
const FULL_LOAD_CLASS = 'Full Load / Large Load';

// Existing sizes keep their YOLO offsets. Mini Load is appended so those indexes do not move.
const LOAD_SIZE_YOLO_OFFSET = {
  '1/4 Load': 0,
  '1/2 Load': 1,
  '3/4 Load': 2,
  'Full Load / Large Load': 3,
  'Mini Load': 4,
};

function canonicalLoadSize(value) {
  if (value === LEGACY_FULL_LOAD_CLASS) return FULL_LOAD_CLASS;
  return value;
}

function applyCanonicalLoadNames(doc) {
  if (!doc) return;
  if (typeof doc.label === 'string') doc.label = canonicalLoadSize(doc.label);
  if (typeof doc.loadSize === 'string') doc.loadSize = canonicalLoadSize(doc.loadSize);
  if (Array.isArray(doc.boxes)) {
    doc.boxes.forEach((box) => {
      if (box && typeof box.label === 'string') box.label = canonicalLoadSize(box.label);
    });
  }
  if (Array.isArray(doc.loadLabels)) {
    doc.loadLabels.forEach((vote) => {
      if (vote && typeof vote.loadSize === 'string') {
        vote.loadSize = canonicalLoadSize(vote.loadSize);
      }
    });
  }
}

module.exports = {
  LOAD_SIZES,
  LOAD_SIZE_YOLO_OFFSET,
  LEGACY_FULL_LOAD_CLASS,
  FULL_LOAD_CLASS,
  canonicalLoadSize,
  applyCanonicalLoadNames,
};
