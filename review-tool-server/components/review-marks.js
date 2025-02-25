const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();

// Define base directory as "data" folder in the project root
const baseDir = path.join(__dirname, '../data');
if (!fs.existsSync(baseDir)) {
  fs.mkdirSync(baseDir, { recursive: true });
}

// Now, create the topic_reviews folder under the data folder.
const folder = path.join(baseDir, 'topic_reviews');
if (!fs.existsSync(folder)) {
  fs.mkdirSync(folder, { recursive: true });
}

// Helper to get the file path for a document's review marks
function getReviewMarksFile(webhelpId) {
  return path.join(folder, `${webhelpId}_review-marks.json`);
}

// Read review marks from a file specific to the document
function readReviewMarks(webhelpId) {
  const filePath = getReviewMarksFile(webhelpId);
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, '[]', 'utf8');
    return [];
  }
  try {
    const data = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(data);
  } catch (e) {
    console.error('Error reading review marks file:', e);
    return [];
  }
}

// Write review marks to the document-specific file
function writeReviewMarks(webhelpId, marks) {
  const filePath = getReviewMarksFile(webhelpId);
  try {
    fs.writeFileSync(filePath, JSON.stringify(marks, null, 2), 'utf8');
  } catch (e) {
    console.error('Error writing review marks file:', e);
  }
}

// POST: Save or update a review mark
router.post('/saveReviewMarks', (req, res) => {
  const newMark = req.body;
  if (!newMark || !newMark.id || !newMark.webhelpId) {
    return res.status(400).json({ error: 'Invalid data' });
  }
  let marks = readReviewMarks(newMark.webhelpId);
  // Remove any existing mark with the same id
  marks = marks.filter(mark => mark.id !== newMark.id);
  marks.push(newMark);
  writeReviewMarks(newMark.webhelpId, marks);
  res.json({ success: true, marks });
});

// GET: Retrieve review marks for a given document/topic
router.get('/getReviewMarks/:webhelpId/:version/*', (req, res) => {
  const { webhelpId, version } = req.params;
  // req.params[0] captures the rest of the URL (the topic) even if it contains slashes.
  const topic = decodeURIComponent(req.params[0]);
  let marks = readReviewMarks(webhelpId);
  marks = marks.filter(mark =>
    mark.version === version &&
    mark.topic === topic
  );
  res.json(marks);
});

module.exports = router;
