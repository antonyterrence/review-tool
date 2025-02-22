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
 * Updated Save Endpoint: Update annotation if it exists, else push a new one.
 * Preserves the original `user` field if the annotation already exists.
 */
/**
 * Updated Save Endpoint: Update annotation if it exists, else push a new one.
 * This version preserves the original `user` field for existing annotations.
 */
app.post('/saveReviewChange', (req, res) => {
  try {
    const { webhelpId, version, topic, change } = req.body;
    console.log("Received annotation for:", webhelpId, version, topic, change);
    const annotations = readAnnotations(webhelpId);
    if (!annotations[version]) annotations[version] = {};
    if (!annotations[version][topic]) annotations[version][topic] = [];

    // Find the existing annotation by its id
    const index = annotations[version][topic].findIndex(item => item.id === change.id);
    if (index !== -1) {
      // Preserve the original reviewer before updating the annotation.
      const originalUser = annotations[version][topic][index].user;
      // Update the annotation with the new change data
      annotations[version][topic][index] = change;
      // Restore the original user (reviewer) so that the writer doesn't overwrite it.
      annotations[version][topic][index].user = originalUser;
    } else {
      // New annotation: use the change as provided.
      annotations[version][topic].push(change);
    }
    writeAnnotations(annotations, webhelpId);
    res.json({ status: 'ok' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});




app.get('/getReviewChanges/:webhelpId/:version/*', (req, res) => {
  const { webhelpId, version } = req.params;
  const topic = decodeURIComponent(req.params[0]);
  const annotations = readAnnotations(webhelpId);
  let changes = [];
  if (req.query.includePrevious === 'true') {
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
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.json(changes);
});

/**
 * ---------------------------
 * Document Upload Endpoint
 * ---------------------------
 */
app.post('/uploadWebhelp', upload.single('webhelpZip'), (req, res) => {
  if (req.body.docId) {
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
    extractZip(req.file.path, targetDir, () => {
      let subFolder = "";
      if (!fs.existsSync(path.join(targetDir, "index.html"))) {
        const items = fs.readdirSync(targetDir, { withFileTypes: true });
        const subDirs = items.filter(item => item.isDirectory()).map(item => item.name);
        if (subDirs.length > 0) {
          subFolder = subDirs[0];
        }
      }
      let title = "";
      const indexPath = subFolder ? path.join(targetDir, subFolder, "index.html") : path.join(targetDir, "index.html");
      if (fs.existsSync(indexPath)) {
        const fileContent = fs.readFileSync(indexPath, "utf8");
        const match = fileContent.match(/<title>(.*?)<\/title>/i);
        title = match ? match[1] : "";
      }
      res.json({ webhelpId, version, title, subFolder });
    });
  } else {
    const webhelpId = Date.now().toString();
    const version = 'v1';
    const targetDir = path.join(__dirname, 'webhelps', webhelpId, version);
    fs.mkdirSync(targetDir, { recursive: true });
    extractZip(req.file.path, targetDir, () => {
      let subFolder = "";
      if (!fs.existsSync(path.join(targetDir, "index.html"))) {
        const items = fs.readdirSync(targetDir, { withFileTypes: true });
        const subDirs = items.filter(item => item.isDirectory()).map(item => item.name);
        if (subDirs.length > 0) {
          subFolder = subDirs[0];
        }
      }
      let title = "";
      const indexPath = subFolder ? path.join(targetDir, subFolder, "index.html") : path.join(targetDir, "index.html");
      if (fs.existsSync(indexPath)) {
        const fileContent = fs.readFileSync(indexPath, "utf8");
        const match = fileContent.match(/<title>(.*?)<\/title>/i);
        title = match ? match[1] : "";
      }
      res.json({ webhelpId, version, title, subFolder });
    });
  }
});

app.get('/webhelp/:webhelpId/:version/*', (req, res) => {
  const { webhelpId, version } = req.params;
  const topicPath = req.params[0];
  const filePath = path.join(__dirname, 'webhelps', webhelpId, version, topicPath);
  res.sendFile(filePath);
});


app.get('/getReviewMetrics/:webhelpId/:version', function(req, res) {
  var webhelpId = req.params.webhelpId;
  var versionParam = req.params.version;
  var annotations = readAnnotations(webhelpId);
  var perReviewerPerVersion = {};

  if (versionParam.toLowerCase() === 'all') {
    // Loop over all versions.
    Object.keys(annotations).forEach(function(v) {
      var versionAnnotations = annotations[v] || {};
      Object.keys(versionAnnotations).forEach(function(topic) {
        var annotationArray = versionAnnotations[topic];
        annotationArray.forEach(function(ann) {
          var reviewer = ann.user || 'Unknown';
          if (!perReviewerPerVersion[reviewer]) {
            perReviewerPerVersion[reviewer] = {};
          }
          if (!perReviewerPerVersion[reviewer][v]) {
            perReviewerPerVersion[reviewer][v] = { total: 0, accepted: 0, rejected: 0, resolved: 0, open: 0 };
          }
          perReviewerPerVersion[reviewer][v].total++;
          switch(ann.status) {
            case 'accepted':
              perReviewerPerVersion[reviewer][v].accepted++;
              break;
            case 'rejected':
              perReviewerPerVersion[reviewer][v].rejected++;
              break;
            case 'resolved':
              perReviewerPerVersion[reviewer][v].resolved++;
              break;
            default:
              perReviewerPerVersion[reviewer][v].open++;
          }
        });
      });
    });
  } else {
    // Only one version requested.
    var versionAnnotations = annotations[versionParam] || {};
    Object.keys(versionAnnotations).forEach(function(topic) {
      var annotationArray = versionAnnotations[topic];
      annotationArray.forEach(function(ann) {
        var reviewer = ann.user || 'Unknown';
        if (!perReviewerPerVersion[reviewer]) {
          perReviewerPerVersion[reviewer] = {};
        }
        if (!perReviewerPerVersion[reviewer][versionParam]) {
          perReviewerPerVersion[reviewer][versionParam] = { total: 0, accepted: 0, rejected: 0, resolved: 0, open: 0 };
        }
        perReviewerPerVersion[reviewer][versionParam].total++;
        switch(ann.status) {
          case 'accepted':
            perReviewerPerVersion[reviewer][versionParam].accepted++;
            break;
          case 'rejected':
            perReviewerPerVersion[reviewer][versionParam].rejected++;
            break;
          case 'resolved':
            perReviewerPerVersion[reviewer][versionParam].resolved++;
            break;
          default:
            perReviewerPerVersion[reviewer][versionParam].open++;
        }
      });
    });
  }
  
  res.json({
    perReviewerPerVersion: perReviewerPerVersion
  });
});



function extractZip(sourcePath, destPath, callback) {
  fs.createReadStream(sourcePath)
    .pipe(unzipper.Parse())
    .on('entry', function(entry) {
      const entryPath = entry.path;
      const fullPath = path.join(destPath, entryPath);
      if (entry.type === 'Directory') {
        fs.mkdirSync(fullPath, { recursive: true });
        entry.autodrain();
      } else {
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        entry.pipe(fs.createWriteStream(fullPath));
      }
    })
    .on('close', callback)
    .on('error', callback);
}

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

/**
 * ---------------------------
 * Socket.IO Integration
 * ---------------------------
 */
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
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
    socket.to(data.room).emit('cursor-update', { id: socket.id, ...data });
  });

  // NEW: Relay annotation changes to other clients in the room.
  socket.on('annotation-change', (data) => {
    socket.to(data.room).emit('annotation-change', data);
  });
  
  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
  });
});


const PORT = 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
