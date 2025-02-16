const express = require('express');
const multer = require('multer');
const unzipper = require('unzipper');
const path = require('path');
const fs = require('fs');
const bodyParser = require('body-parser');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
app.use(bodyParser.json());

// Serve static files from the review-tool-client folder.
app.use(express.static(path.join(__dirname, '../review-tool-client')));

// Configure multer for file uploads.
const upload = multer({ dest: 'uploads/' });

/**
 * ---------------------------
 * Annotations Persistence
 * ---------------------------
 */
const annotationsDir = path.join(__dirname, 'annotations');
if (!fs.existsSync(annotationsDir)) {
  fs.mkdirSync(annotationsDir);
}
function getAnnotationsFile(webhelpId) {
  return path.join(annotationsDir, `${webhelpId}.json`);
}
function readAnnotations(webhelpId) {
  const filePath = getAnnotationsFile(webhelpId);
  try {
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, '{}', 'utf8');
    }
    const data = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error("Error reading annotations file:", err);
    return {};
  }
}
function writeAnnotations(data, webhelpId) {
  const filePath = getAnnotationsFile(webhelpId);
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error("Error writing annotations file:", err);
  }
}

/**
 * ---------------------------
 * Document Upload Endpoint
 * ---------------------------
 */
app.post('/uploadWebhelp', upload.single('webhelpZip'), (req, res) => {
  if (req.body.docId) {
    // New version upload for an existing document.
    const webhelpId = req.body.docId;
    const docDir = path.join(__dirname, 'webhelps', webhelpId);
    let newVersionNumber = 1;
    if (fs.existsSync(docDir)) {
      const versionDirs = fs.readdirSync(docDir, { withFileTypes: true })
                           .filter(item => item.isDirectory())
                           .map(item => item.name);
      const versionNumbers = versionDirs.map(dir => parseInt(dir.replace('v', ''))).filter(n => !isNaN(n));
      if (versionNumbers.length > 0) {
        newVersionNumber = Math.max(...versionNumbers) + 1;
      }
    } else {
      fs.mkdirSync(docDir, { recursive: true });
    }
    const version = "v" + newVersionNumber;
    const targetDir = path.join(docDir, version);
    fs.mkdirSync(targetDir, { recursive: true });
    fs.createReadStream(req.file.path)
      .pipe(unzipper.Extract({ path: targetDir }))
      .on('close', () => {
        const items = fs.readdirSync(targetDir, { withFileTypes: true });
        let subDirs = items.filter(item => item.isDirectory()).map(item => item.name);
        let subFolder = subDirs.length > 0 ? subDirs[0] : "";
        if (newVersionNumber > 1 && subFolder) {
          const newSubFolder = subFolder + "_" + newVersionNumber;
          const oldPath = path.join(targetDir, subFolder);
          const newPath = path.join(targetDir, newSubFolder);
          try {
            fs.renameSync(oldPath, newPath);
            subFolder = newSubFolder;
          } catch (err) {
            console.error("Error renaming subfolder:", err);
          }
        }
        let title = "";
        const indexPath = path.join(targetDir, subFolder, "index.html");
        if (fs.existsSync(indexPath)) {
          const fileContent = fs.readFileSync(indexPath, "utf8");
          const match = fileContent.match(/<title>(.*?)<\/title>/i);
          title = match ? match[1] : "";
        }
        res.json({ webhelpId, version, title, subFolder });
      });
  } else {
    // New document upload.
    const webhelpId = Date.now().toString();
    const version = 'v1';
    const targetDir = path.join(__dirname, 'webhelps', webhelpId, version);
    fs.mkdirSync(targetDir, { recursive: true });
    fs.createReadStream(req.file.path)
      .pipe(unzipper.Extract({ path: targetDir }))
      .on('close', () => {
        const items = fs.readdirSync(targetDir, { withFileTypes: true });
        const subDirs = items.filter(item => item.isDirectory()).map(item => item.name);
        const subFolder = subDirs.length > 0 ? subDirs[0] : "";
        let title = "";
        const indexPath = path.join(targetDir, subFolder, "index.html");
        if (fs.existsSync(indexPath)) {
          const fileContent = fs.readFileSync(indexPath, "utf8");
          const match = fileContent.match(/<title>(.*?)<\/title>/i);
          title = match ? match[1] : "";
        }
        res.json({ webhelpId, version, title, subFolder });
      });
  }
});

/**
 * ---------------------------
 * Serve Topic Files
 * ---------------------------
 */
app.get('/webhelp/:webhelpId/:version/*', (req, res) => {
  const { webhelpId, version } = req.params;
  const topicPath = req.params[0];
  const filePath = path.join(__dirname, 'webhelps', webhelpId, version, topicPath);
  res.sendFile(filePath);
});

/**
 * ---------------------------
 * Save and Retrieve Annotations
 * ---------------------------
 */
app.post('/saveReviewChange', (req, res) => {
  const { webhelpId, version, topic, change } = req.body;
  console.log("Received annotation for:", webhelpId, version, topic, change);
  const annotations = readAnnotations(webhelpId);
  if (!annotations[version]) annotations[version] = {};
  if (!annotations[version][topic]) annotations[version][topic] = [];
  annotations[version][topic].push(change);
  writeAnnotations(annotations, webhelpId);
  res.json({ status: 'ok' });
});
app.get('/getReviewChanges/:webhelpId/:version/*', (req, res) => {
  const { webhelpId, version } = req.params;
  const topic = decodeURIComponent(req.params[0]);
  const annotations = readAnnotations(webhelpId);
  let changes = [];
  if (req.query.includePrevious === 'true') {
    // Merge annotations from all versions up to the current one.
    const currentVersionNum = parseInt(version.substring(1)) || 1;
    Object.keys(annotations).forEach(ver => {
      const verNum = parseInt(ver.substring(1)) || 1;
      if (verNum <= currentVersionNum && annotations[ver] && annotations[ver][topic]) {
        changes = changes.concat(annotations[ver][topic]);
      }
    });
  } else {
    changes = (annotations[version] && annotations[version][topic]) || [];
  }
  // Disable caching so fresh data is always returned.
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.json(changes);
});


/**
 * ---------------------------
 * Document Records Persistence (shared across clients)
 * ---------------------------
 */
const documentsFile = path.join(__dirname, 'documents.json');
function readDocuments() {
  try {
    if (!fs.existsSync(documentsFile)) {
      fs.writeFileSync(documentsFile, '[]', 'utf8');
    }
    const data = fs.readFileSync(documentsFile, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error("Error reading documents file:", err);
    return [];
  }
}
function writeDocuments(docs) {
  try {
    fs.writeFileSync(documentsFile, JSON.stringify(docs, null, 2), 'utf8');
  } catch (err) {
    console.error("Error writing documents file:", err);
  }
}
app.get('/getDocuments', (req, res) => {
  const docs = readDocuments();
  res.json(docs);
});
app.post('/saveDocument', (req, res) => {
  const doc = req.body;
  const docs = readDocuments();
  docs.push(doc);
  writeDocuments(docs);
  res.json({ status: 'ok' });
});
app.post('/updateDocument', (req, res) => {
  const { docId, newVersion } = req.body;
  const docs = readDocuments();
  const index = docs.findIndex(d => d.docId === docId);
  if (index !== -1) {
    docs[index].versions.push(newVersion);
    writeDocuments(docs);
    res.json({ status: 'ok' });
  } else {
    res.status(404).json({ status: 'error', message: 'Document not found' });
  }
});

// --- Socket.IO Integration ---
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*", // Adjust for production
    methods: ["GET", "POST"],
  },
});

io.on('connection', (socket) => {
  console.log(`New client connected: ${socket.id}`);

  socket.on('joinRoom', (room) => {
    socket.join(room);
    console.log(`Socket ${socket.id} joined room ${room}`);
  });

  socket.on('cursor-update', (data) => {
    const { room, cursorX, cursorY, user, currentTopic } = data;
    socket.to(room).emit('cursor-update', { id: socket.id, cursorX, cursorY, user, currentTopic });
  });
  

  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
  });
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
