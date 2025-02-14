/************************************************
 * Global Variables and Topic Identification
 ************************************************/
const params = new URLSearchParams(window.location.search);
const webhelpId = params.get("webhelpId");
const version = params.get("version");
const subFolder = params.get("subFolder");
// Retrieve current topic from localStorage; default to "default".
let currentTopic = localStorage.getItem("currentTopic") || "default";

/************************************************
 * Socket.IO Integration
 ************************************************/
// Initialize Socket.IO client (make sure the socket.io client library is included in your HTML)
const socket = io();
socket.on('connect', () => {
  console.log('Connected to Socket.IO server:', socket.id);
  // Join a room for the current document using webhelpId and version.
  const room = 'document-' + webhelpId + '-' + version;
  socket.emit('joinRoom', room);
});
socket.on('cursor-update', (data) => {
  console.log('Received cursor update:', data);
  // Optionally, update the UI to show other reviewers' positions.
});

/************************************************
 * Global and Topic Cursor Indicators
 ************************************************/
const globalActiveUsers = {};  // { socketId: { user, lastUpdate } }
const topicCursorMarkers = {}; // { socketId: markerElement }

// Function to update the global active users display
function updateGlobalActiveUsersDisplay() {
  const container = document.getElementById('globalActiveUsers');
  if (!container) return;
  container.innerHTML = ''; // Clear existing list
  Object.values(globalActiveUsers).forEach(userObj => {
    const userDiv = document.createElement('div');
    userDiv.className = 'global-user';
    userDiv.textContent = userObj.user;
    container.appendChild(userDiv);
  });
}

/************************************************
 * Cursor Marker for Other Users
 ************************************************/
// A map to keep track of other users’ cursor markers
const otherCursorMarkers = {};

// Handle incoming cursor update events
socket.on('cursor-update', (data) => {
  // Ignore updates from our own socket
  if (data.id === socket.id) return;

  // Update the global active users list
  globalActiveUsers[data.id] = { user: data.user, lastUpdate: Date.now() };
  updateGlobalActiveUsersDisplay();

  // If the sending user is on the same topic, update/create their topic-level marker
  if (data.currentTopic === currentTopic) {
    let marker = topicCursorMarkers[data.id];
    if (!marker) {
      marker = document.createElement('div');
      marker.className = 'topic-cursor-marker';
      // Create a label to show the user's name
      const label = document.createElement('div');
      label.className = 'cursor-label';
      label.textContent = data.user;
      marker.appendChild(label);
      // Append the marker inside the topicContent element
      topicContent.appendChild(marker);
      topicCursorMarkers[data.id] = marker;
    }
    // Update marker position relative to topicContent
    const rect = topicContent.getBoundingClientRect();
    marker.style.left = (data.cursorX - rect.left) + 'px';
    marker.style.top = (data.cursorY - rect.top) + 'px';
    // Store the last update time on the marker element
    marker.dataset.lastUpdate = Date.now();
  } else {
    // If the user is not on the same topic, remove their topic marker if it exists
    if (topicCursorMarkers[data.id]) {
      topicCursorMarkers[data.id].remove();
      delete topicCursorMarkers[data.id];
    }
  }
});

// Cleanup stale indicators every 3 seconds
setInterval(() => {
  const now = Date.now();
  // Remove global users who haven't updated in over 3000ms
  Object.keys(globalActiveUsers).forEach(id => {
    if (now - globalActiveUsers[id].lastUpdate > 3000) {
      delete globalActiveUsers[id];
    }
  });
  updateGlobalActiveUsersDisplay();
  
  // Remove topic markers not updated in over 3000ms
  Object.keys(topicCursorMarkers).forEach(id => {
    const marker = topicCursorMarkers[id];
    if (now - marker.dataset.lastUpdate > 3000) {
      marker.remove();
      delete topicCursorMarkers[id];
    }
  });
}, 3000);

/************************************************
 * Advanced Serialization Helper Functions
 ************************************************/
/**
 * Returns an XPath for a given node relative to a root element.
 * It builds a path by counting the node’s position among siblings.
 */
function getXPathForNode(node, root) {
  if (node === root) return ".";
  let parts = [];
  while (node && node !== root) {
    if (node.nodeType === Node.TEXT_NODE) {
      // For text nodes, use 'text()' with an index.
      let index = 1;
      let sibling = node.previousSibling;
      while (sibling) {
        if (sibling.nodeType === Node.TEXT_NODE) {
          index++;
        }
        sibling = sibling.previousSibling;
      }
      parts.unshift(`text()[${index}]`);
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      let index = 1;
      let sibling = node.previousSibling;
      while (sibling) {
        if (sibling.nodeType === Node.ELEMENT_NODE && sibling.nodeName === node.nodeName) {
          index++;
        }
        sibling = sibling.previousSibling;
      }
      parts.unshift(node.nodeName.toLowerCase() + `[${index}]`);
    }
    node = node.parentNode;
  }
  return "./" + parts.join("/");
}

/**
 * Returns the first node that matches the given XPath relative to the root.
 */
function getNodeByXPath(xpath, root) {
  let evaluator = new XPathEvaluator();
  let result = evaluator.evaluate(xpath, root, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
  return result.singleNodeValue;
}

/**
 * Advanced serialization:
 * - If the range’s common ancestor is an ordered or unordered list (<ol> or <ul>)
 *   and the selection spans complete <li> elements, then serialize the full outerHTML of those <li>s.
 * - Otherwise, clone the range’s contents and store its HTML.
 */
function advancedSerializeRange(range) {
  // Check if the commonAncestorContainer is a list and if the selection spans whole list items.
  let commonAncestor = range.commonAncestorContainer;
  if (commonAncestor.nodeType === Node.TEXT_NODE) {
    commonAncestor = commonAncestor.parentNode;
  }
  if (commonAncestor && (commonAncestor.tagName === "OL" || commonAncestor.tagName === "UL")) {
    // Get all li children that are fully contained in the range.
    const liElements = Array.from(commonAncestor.getElementsByTagName("li")).filter(li => {
      // We require that the entire li is contained within the range.
      let liRange = document.createRange();
      liRange.selectNodeContents(li);
      return range.compareBoundaryPoints(Range.START_TO_START, liRange) <= 0 &&
             range.compareBoundaryPoints(Range.END_TO_END, liRange) >= 0;
    });
    if (liElements.length > 0) {
      const container = document.createElement("div");
      liElements.forEach(li => container.innerHTML += li.outerHTML);
      return {
        startXPath: getXPathForNode(liElements[0], topicContent),
        startOffset: 0,
        endXPath: getXPathForNode(liElements[liElements.length - 1], topicContent),
        endOffset: liElements[liElements.length - 1].outerHTML.length,
        html: container.innerHTML
      };
    }
  }
  // Default: clone the range contents.
  const frag = range.cloneContents();
  const div = document.createElement("div");
  div.appendChild(frag);
  return {
    startXPath: getXPathForNode(range.startContainer, topicContent),
    startOffset: range.startOffset,
    endXPath: getXPathForNode(range.endContainer, topicContent),
    endOffset: range.endOffset,
    html: div.innerHTML
  };
}

/**
 * Advanced deserialization:
 * Recreates a Range from the stored XPath boundaries.
 */
function advancedDeserializeRange(serialized) {
  const startNode = getNodeByXPath(serialized.startXPath, topicContent);
  const endNode = getNodeByXPath(serialized.endXPath, topicContent);
  if (!startNode || !endNode) return null;
  const range = document.createRange();
  try {
    range.setStart(startNode, serialized.startOffset);
    range.setEnd(endNode, serialized.endOffset);
  } catch (e) {
    console.error("Error deserializing range:", e);
    return null;
  }
  return range;
}

/* Use the advanced serialization functions */
function serializeRange(range) {
  return advancedSerializeRange(range);
}
function deserializeRange(serialized) {
  return advancedDeserializeRange(serialized);
}

/************************************************
 * TOC & Topic Loading
 ************************************************/
if (!webhelpId || !version || !subFolder) {
  document.getElementById("tocList").innerHTML = "<p>Missing document parameters.</p>";
  document.getElementById("topicContent").innerHTML = "<p>Cannot load document.</p>";
} else {
  const indexUrl = `/webhelp/${webhelpId}/${version}/${subFolder}/index.html`;
  fetch(indexUrl)
    .then(response => {
      if (!response.ok) {
        throw new Error("Network response was not ok: " + response.statusText);
      }
      return response.text();
    })
    .then(html => {
      const tempDiv = document.createElement("div");
      tempDiv.innerHTML = html;
      const tocList = document.getElementById("tocList");
      tocList.innerHTML = "";
      const tocElement = tempDiv.querySelector("nav ul.map");
      if (tocElement) {
        tocList.innerHTML = tocElement.outerHTML;
        const tocLinks = tocList.querySelectorAll("a");
        tocLinks.forEach(link => {
          link.addEventListener("click", function(event) {
            event.preventDefault();
            let href = this.getAttribute("href");
            currentTopic = href.replace('.html','');
            localStorage.setItem("currentTopic", currentTopic);
            const topicUrl = `/webhelp/${webhelpId}/${version}/${subFolder}/${href}`;
            fetch(topicUrl)
              .then(resp => {
                if (!resp.ok) {
                  throw new Error("Network response was not ok: " + resp.statusText);
                }
                return resp.text();
              })
              .then(topicHtml => {
                document.getElementById("topicContent").innerHTML = topicHtml;
                overrideTopicLinks();
                loadAnnotationsFromServer(currentTopic);
              })
              .catch(err => {
                console.error("Error loading topic:", err);
                document.getElementById("topicContent").innerHTML = "<p>Error loading topic.</p>";
              });
          });
        });
        if (tocLinks.length > 0) {
          let found = false;
          tocLinks.forEach(link => {
            if (link.getAttribute("href").replace('.html','') === currentTopic) {
              link.click();
              found = true;
            }
          });
          if (!found) {
            tocLinks[0].click();
          }
        }
      } else {
        const headings = tempDiv.querySelectorAll("h2");
        if (headings.length === 0) {
          tocList.innerHTML = "<p>No TOC found.</p>";
        } else {
          headings.forEach((heading, idx) => {
            const tocItem = document.createElement("div");
            tocItem.className = "tocItem";
            tocItem.textContent = heading.textContent;
            tocItem.addEventListener("click", () => {
              currentTopic = "topic" + (idx + 1);
              localStorage.setItem("currentTopic", currentTopic);
              const topicUrl = `/webhelp/${webhelpId}/${version}/${subFolder}/topic${idx + 1}.html`;
              fetch(topicUrl)
                .then(resp => {
                  if (!resp.ok) {
                    throw new Error("Network response was not ok: " + resp.statusText);
                  }
                  return resp.text();
                })
                .then(topicHtml => {
                  document.getElementById("topicContent").innerHTML = topicHtml;
                  overrideTopicLinks();
                  loadAnnotationsFromServer(currentTopic);
                })
                .catch(err => {
                  console.error("Error loading topic:", err);
                  document.getElementById("topicContent").innerHTML = "<p>Error loading topic.</p>";
                });
            });
            tocList.appendChild(tocItem);
          });
          if (headings.length > 0) {
            tocList.querySelector(".tocItem").click();
          }
        }
      }
    })
    .catch(error => {
      console.error("Error loading index.html:", error);
      document.getElementById("tocList").innerHTML = "<p>Error loading TOC.</p>";
      document.getElementById("topicContent").innerHTML = "<p>Error loading document content.</p>";
    });
}

function overrideTopicLinks() {
  const topicDiv = document.getElementById("topicContent");
  const links = topicDiv.querySelectorAll("a");
  links.forEach(link => {
    link.addEventListener("click", function(event) {
      event.preventDefault();
      const href = this.getAttribute("href");
      currentTopic = href.replace('.html','');
      localStorage.setItem("currentTopic", currentTopic);
      const topicUrl = `/webhelp/${webhelpId}/${version}/${subFolder}/${href}`;
      fetch(topicUrl)
        .then(resp => {
          if (!resp.ok) {
            throw new Error("Network response was not ok: " + resp.statusText);
          }
          return resp.text();
        })
        .then(newTopicHtml => {
          topicDiv.innerHTML = newTopicHtml;
          overrideTopicLinks();
          loadAnnotationsFromServer(currentTopic);
        })
        .catch(err => {
          console.error("Error loading linked topic:", err);
        });
    });
  });
}

/************************************************
 * Annotation, Context Menu, and Review Panel Features
 ************************************************/
const topicContent = document.getElementById("topicContent");
const contextMenu = document.getElementById("contextMenu");
const overlay = document.getElementById("overlay");
let selectedText = '';
let selectedRange = null;
let currentReplyTarget = null;
let currentEditTarget = null;
const annotationMap = new Map();
const currentUserAnnotation = localStorage.getItem("currentUser") || "User1";
let reviewItems = [];

/************************************************
 * Socket.IO: Emit Cursor Position on Mouse Move
 ************************************************/
topicContent.addEventListener('mousemove', (event) => {
  const room = 'document-' + webhelpId + '-' + version;
  socket.emit('cursor-update', { 
    room, 
    cursorX: event.clientX, 
    cursorY: event.clientY, 
    user: currentUserAnnotation, 
    currentTopic: currentTopic 
  });
});


/* Helper to check if an element is a heading */
function isHeadingElement(elem) {
  return elem && elem.tagName && /^H[1-6]$/.test(elem.tagName);
}

/* Reapply a comment marker using advanced serialization */
function reapplyCommentMarker(annotation) {
  if (!annotation.range) return;
  const range = advancedDeserializeRange(annotation.range);
  if (range) {
    const marker = document.createElement("span");
    marker.className = "comment-marker";
    marker.dataset.commentId = annotation.id;
    // Use the stored HTML for the comment (if available) to preserve formatting.
    marker.innerHTML = annotation.range.html || range.toString();
    try {
      range.surroundContents(marker);
      annotationMap.set(annotation.id, marker);
    } catch (e) {
      console.error("Error reapplying comment marker:", e);
    }
  }
}

/* Reapply a deletion marker using advanced serialization */
function reapplyDeletionMarker(annotation) {
  if (!annotation.range) return;
  const range = advancedDeserializeRange(annotation.range);
  if (!range) return;
  const marker = document.createElement("span");
  marker.className = "deleted-text";
  marker.dataset.deletionId = annotation.id;
  marker.innerHTML = annotation.deletedHtml || annotation.deletedText;
  try {
    range.deleteContents();
    range.insertNode(marker);
  } catch (e) {
    console.error("Error reapplying deletion marker:", e);
  }
}

/* Reapply a highlight marker using advanced serialization */
function reapplyHighlightMarker(annotation) {
  if (!annotation.range) return;
  const range = advancedDeserializeRange(annotation.range);
  if (!range) return;
  const marker = document.createElement("span");
  marker.className = "annotator-hl";
  marker.dataset.highlightId = annotation.id;
  marker.innerHTML = annotation.highlightedHtml || annotation.highlightedText || range.toString();
  try {
    range.deleteContents();
    range.insertNode(marker);
  } catch (e) {
    console.error("Error reapplying highlight marker:", e);
  }
}

/* Reapply a replacement marker using advanced serialization */
function reapplyReplacementMarker(annotation) {
  if (!annotation.range) return;
  const range = advancedDeserializeRange(annotation.range);
  if (!range) return;
  const deletedSpan = document.createElement("span");
  deletedSpan.className = "deleted-text";
  deletedSpan.dataset.deletionId = annotation.id;
  deletedSpan.innerHTML = annotation.oldHtml || annotation.oldText;
  const insertedSpan = document.createElement("span");
  insertedSpan.className = "inserted-text";
  insertedSpan.textContent = annotation.newText;
  try {
    range.deleteContents();
    range.insertNode(deletedSpan);
    range.insertNode(document.createTextNode(" "));
    range.insertNode(insertedSpan);
  } catch (e) {
    console.error("Error reapplying replacement marker:", e);
  }
}

/* Load annotations from the server for the current topic */
function loadAnnotationsFromServer(topic) {
  if (!topic) topic = "default";
  currentTopic = topic;
  localStorage.setItem("currentTopic", currentTopic);
  fetch(`/getReviewChanges/${webhelpId}/${version}/${encodeURIComponent(topic)}`)
    .then(response => response.json())
    .then(flatAnnotations => {
      const annotationsMap = {};
      flatAnnotations.forEach(a => {
        annotationsMap[a.id] = a;
        a.replies = [];
      });
      const topAnnotations = [];
      flatAnnotations.forEach(a => {
        if (a.parentId) {
          if (annotationsMap[a.parentId]) {
            annotationsMap[a.parentId].replies.push(a);
          }
        } else {
          topAnnotations.push(a);
        }
      });
      const reviewList = document.getElementById("reviewList");
      reviewList.innerHTML = "";
      reviewItems = [];
      topAnnotations.forEach(a => {
        const item = createReviewItem(a.type, a);
        if (a.type === 'comment' && a.range) {
          reapplyCommentMarker(a);
        } else if (a.type === 'deletion' && a.range) {
          reapplyDeletionMarker(a);
        } else if (a.type === 'highlight' && a.range) {
          reapplyHighlightMarker(a);
        } else if (a.type === 'replacement' && a.range) {
          reapplyReplacementMarker(a);
        }
        if (a.replies && a.replies.length > 0) {
          const repliesContainer = item.querySelector('.replies');
          a.replies.forEach(reply => {
            const replyItem = createReviewItem(reply.type, reply);
            repliesContainer.appendChild(replyItem);
          });
        }
        reviewList.appendChild(item);
        reviewItems.push(a);
      });
    })
    .catch(error => {
      console.error("Error loading annotations from server:", error);
    });
}

// Load annotations on page load.
window.addEventListener("load", () => {
  loadAnnotationsFromServer(currentTopic);
});

// Listen for text selection in topicContent.
topicContent.addEventListener('mouseup', (event) => {
  const selection = window.getSelection();
  if (selection.toString().trim() && topicContent.contains(selection.anchorNode)) {
    selectedText = selection.toString();
    selectedRange = selection.getRangeAt(0);
    contextMenu.style.display = 'block';
    contextMenu.style.left = `${event.pageX}px`;
    contextMenu.style.top = `${event.pageY}px`;
  }
});
document.addEventListener('mousedown', (event) => {
  if (!contextMenu.contains(event.target)) {
    contextMenu.style.display = 'none';
  }
});

/* Create a review item for the review panel */
function createReviewItem(type, data) {
  const item = document.createElement('div');
  item.className = `review-item ${type}`;
  item.dataset.itemId = data.id;
  item.dataset.type = type;
  switch (type) {
    case 'comment':
      item.innerHTML = `
        <div class="author">
          <div class="username">${data.user}</div>
          <div class="timestamp">${data.timestamp}</div>
          <button class="ellipsis-btn">⋮</button>
        </div>
        <div class="text">${data.text}</div>
        <div class="comment-actions">
          <button class="reply-btn">Reply</button>
        </div>
        <div class="replies"></div>
      `;
      break;
    case 'deletion':
      item.innerHTML = `
        <div class="deletion-meta">
          <strong>${data.user}</strong>
          <small>${data.timestamp}</small>
        </div>
        <div class="deletion-text">Deleted: ${data.deletedText || data.deletedHtml || ""}</div>
      `;
      break;
    case 'highlight':
      item.innerHTML = `
        <div class="replacement-meta">
          <strong>${data.user}</strong>
          <small>${data.timestamp}</small>
        </div>
        <div class="replacement-content">
          Highlighted: <span class="text-highlight">${data.highlightedText || data.highlightedHtml || ""}</span>
        </div>
      `;
      break;
    case 'replacement':
      item.innerHTML = `
        <div class="replacement-meta">
          <strong>${data.user}</strong>
          <small>${data.timestamp}</small>
        </div>
        <div class="replacement-content">
          <div>Replaced: <span class="deleted-text">${data.oldText || data.oldHtml || ""}</span></div>
          <div>With: <span class="replacement-text">${data.newText}</span></div>
        </div>
      `;
      break;
  }
  return item;
}

// --- Submit Comment Handler ---
// (For comments we now use basic text serialization to avoid interfering with DOM structure.)
document.getElementById('submitComment').addEventListener('click', () => {
  const text = document.getElementById('commentText').value.trim();
  if (text && selectedRange) {
    const commentId = Date.now().toString();
    // Use advanced serialization so that the comment range includes XPath info.
    const serialized = advancedSerializeRange(selectedRange.cloneRange());
    const comment = {
      id: commentId,
      type: 'comment',
      user: currentUserAnnotation,
      text: text,
      timestamp: new Date().toLocaleString(),
      range: serialized
    };
    const commentSpan = document.createElement("span");
    commentSpan.className = "comment-marker";
    commentSpan.dataset.commentId = commentId;
    // Use the serialized HTML fragment so that formatting is preserved.
    commentSpan.innerHTML = serialized.html;
    selectedRange.deleteContents();
    selectedRange.insertNode(commentSpan);
    annotationMap.set(commentId, commentSpan);
    const reviewItem = createReviewItem('comment', comment);
    document.getElementById('reviewList').appendChild(reviewItem);
    reviewItems.push(comment);
    saveAnnotationToServer(comment, currentTopic);
    closeModals();
  }
});

// --- Submit Reply Handler ---
document.getElementById('submitReply').addEventListener('click', () => {
  const text = document.getElementById('replyText').value.trim();
  if (text && currentReplyTarget) {
    const reply = {
      id: Date.now().toString(),
      type: 'comment',
      user: currentUserAnnotation,
      text: text,
      timestamp: new Date().toLocaleString(),
      parentId: currentReplyTarget.dataset.itemId,
      range: annotationMap.get(currentReplyTarget.dataset.itemId)
    };
    const replyElement = createReviewItem('comment', reply);
    const repliesContainer = currentReplyTarget.querySelector('.replies');
    repliesContainer.appendChild(replyElement);
    const parentComment = reviewItems.find(item => item.id === currentReplyTarget.dataset.itemId);
    if (parentComment) {
      parentComment.replies = parentComment.replies || [];
      parentComment.replies.push(reply);
    }
    annotationMap.set(reply.id, reply.range);
    saveAnnotationToServer(reply, currentTopic);
    closeModals();
  }
});

// --- Submit Edit Handler ---
document.getElementById('submitEdit').addEventListener('click', () => {
  const text = document.getElementById('editText').value.trim();
  if (text && currentEditTarget) {
    currentEditTarget.querySelector('.text').textContent = text;
    const comment = reviewItems.find(item => item.id === currentEditTarget.dataset.itemId);
    if (comment) comment.text = text;
    saveAnnotationToServer(comment, currentTopic);
    closeModals();
  }
});

// --- Cancel Actions ---
document.getElementById('cancelReply').addEventListener('click', closeModals);
document.getElementById('cancelEdit').addEventListener('click', closeModals);
document.getElementById('cancelComment').addEventListener('click', closeModals);
document.getElementById('replaceCancel').addEventListener('click', closeModals);

// --- Highlight Functionality ---
document.getElementById('highlightButton').addEventListener('click', () => {
  if (selectedRange) {
    const highlightId = Date.now().toString();
    const serialized = advancedSerializeRange(selectedRange.cloneRange());
    const highlight = {
      id: highlightId,
      type: 'highlight',
      user: currentUserAnnotation,
      highlightedHtml: serialized.html,
      timestamp: new Date().toLocaleString(),
      range: serialized
    };
    const span = document.createElement('span');
    span.className = 'annotator-hl';
    span.innerHTML = serialized.html;
    selectedRange.deleteContents();
    selectedRange.insertNode(span);
    const item = createReviewItem('highlight', highlight);
    document.getElementById('reviewList').appendChild(item);
    reviewItems.push(highlight);
    annotationMap.set(highlight.id, highlight.range);
    contextMenu.style.display = 'none';
    saveAnnotationToServer(highlight, currentTopic);
  }
});

// --- Delete Functionality ---
document.getElementById('deleteButton').addEventListener('click', () => {
  if (selectedRange) {
    const deletionId = Date.now().toString();
    const serialized = advancedSerializeRange(selectedRange.cloneRange());
    const deletion = {
      id: deletionId,
      type: 'deletion',
      user: currentUserAnnotation,
      deletedHtml: serialized.html,
      timestamp: new Date().toLocaleString(),
      range: serialized
    };
    const span = document.createElement('span');
    span.className = 'deleted-text';
    span.innerHTML = serialized.html;
    selectedRange.deleteContents();
    selectedRange.insertNode(span);
    const item = createReviewItem('deletion', deletion);
    document.getElementById('reviewList').appendChild(item);
    reviewItems.push(deletion);
    annotationMap.set(deletion.id, deletion.range);
    contextMenu.style.display = 'none';
    saveAnnotationToServer(deletion, currentTopic);
  }
});

// --- Replace Functionality ---
document.getElementById('replaceConfirm').addEventListener('click', () => {
  const newText = document.getElementById('replaceTo').value.trim();
  if (newText && selectedRange) {
    const replacementId = Date.now().toString();
    const serialized = advancedSerializeRange(selectedRange.cloneRange());
    const replacement = {
      id: replacementId,
      type: 'replacement',
      user: currentUserAnnotation,
      oldHtml: serialized.html,
      newText: newText,
      timestamp: new Date().toLocaleString(),
      range: serialized
    };
    const deletedSpan = document.createElement('span');
    deletedSpan.className = 'deleted-text';
    deletedSpan.dataset.deletionId = replacementId;
    deletedSpan.innerHTML = serialized.html;
    const insertedSpan = document.createElement('span');
    insertedSpan.className = 'inserted-text';
    insertedSpan.textContent = newText;
    selectedRange.deleteContents();
    selectedRange.insertNode(deletedSpan);
    selectedRange.insertNode(document.createTextNode(' '));
    selectedRange.insertNode(insertedSpan);
    const item = createReviewItem('replacement', replacement);
    document.getElementById('reviewList').appendChild(item);
    reviewItems.push(replacement);
    annotationMap.set(replacement.id, replacement.range);
    closeModals();
    saveAnnotationToServer(replacement, currentTopic);
  }
});

// --- When clicking on a review item, highlight its associated comment marker ---
document.getElementById('reviewList').addEventListener('click', (e) => {
  const item = e.target.closest('.review-item');
  if (!item) return;
  if (item.dataset.type === 'comment') {
    const commentId = item.dataset.itemId;
    const marker = document.querySelector(`#topicContent .comment-marker[data-comment-id="${commentId}"]`);
    if (marker) {
      marker.classList.add("temp-highlight");
      marker.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => marker.classList.remove("temp-highlight"), 2000);
    }
    if (e.target.classList.contains('reply-btn')) {
      currentReplyTarget = item;
      showModal('replyModal');
    }
    if (e.target.classList.contains('edit-btn')) {
      currentEditTarget = item;
      const textElem = item.querySelector('.text');
      if (textElem) {
        document.getElementById('editText').value = textElem.textContent;
      }
      showModal('editModal');
    }
  }
});

// --- Hover Effects: Highlight marker in topic when hovering deletion/replacement/highlight items ---
document.getElementById('reviewList').addEventListener('mouseover', (e) => {
  const item = e.target.closest('.review-item');
  if (!item) return;
  const type = item.dataset.type;
  const id = item.dataset.itemId;
  if (type === 'deletion' || type === 'replacement' || type === 'highlight') {
    let marker = document.querySelector(`[data-deletion-id="${id}"]`) || document.querySelector(`[data-highlight-id="${id}"]`);
    if (marker) {
      marker.classList.add("temp-highlight");
    }
  }
});
document.getElementById('reviewList').addEventListener('mouseout', (e) => {
  const item = e.target.closest('.review-item');
  if (!item) return;
  const type = item.dataset.type;
  const id = item.dataset.itemId;
  if (type === 'deletion' || type === 'replacement' || type === 'highlight') {
    let marker = document.querySelector(`[data-deletion-id="${id}"]`) || document.querySelector(`[data-highlight-id="${id}"]`);
    if (marker) {
      marker.classList.remove("temp-highlight");
    }
  }
});

// --- Show Comment Modal ---
document.getElementById('commentButton').addEventListener('click', () => {
  showModal('speechBubble');
});

// --- Show Replace Modal ---
document.getElementById('replaceButton').addEventListener('click', () => {
  document.getElementById('replaceFrom').value = selectedText;
  showModal('replaceModal');
});

// --- Modal Handling Functions ---
function showModal(modalId) {
  document.querySelectorAll('.modal').forEach(m => m.style.display = 'none');
  document.getElementById(modalId).style.display = 'block';
  overlay.style.display = 'block';
}
function closeModals() {
  document.querySelectorAll('.modal').forEach(m => m.style.display = 'none');
  overlay.style.display = 'none';
  document.getElementById('commentText').value = '';
  document.getElementById('replyText').value = '';
  document.getElementById('editText').value = '';
  currentReplyTarget = null;
  currentEditTarget = null;
}

// --- Event Delegation for Ellipsis Buttons (Edit/Delete) ---
document.addEventListener("click", function(event) {
  if (event.target && event.target.classList.contains("ellipsis-btn")) {
    event.stopPropagation();
    const existingMenu = document.querySelector(".comment-options-menu");
    if (existingMenu) {
      existingMenu.parentNode.removeChild(existingMenu);
    }
    const menu = document.createElement("div");
    menu.className = "comment-options-menu";
    menu.style.position = "absolute";
    menu.style.background = "white";
    menu.style.border = "1px solid #ccc";
    menu.style.boxShadow = "2px 2px 5px rgba(0,0,0,0.2)";
    menu.style.padding = "5px";
    menu.style.zIndex = "1100";
    const editBtn = document.createElement("button");
    editBtn.textContent = "Edit Comment";
    const deleteBtn = document.createElement("button");
    deleteBtn.textContent = "Delete Comment";
    menu.appendChild(editBtn);
    menu.appendChild(deleteBtn);
    const rect = event.target.getBoundingClientRect();
    menu.style.left = rect.right + "px";
    menu.style.top = rect.top + "px";
    document.body.appendChild(menu);
    editBtn.addEventListener("click", function() {
      const parentComment = event.target.closest(".review-item");
      if (parentComment) {
        currentEditTarget = parentComment;
        const textElem = parentComment.querySelector(".text");
        if (textElem) {
          document.getElementById('editText').value = textElem.textContent;
        }
        showModal('editModal');
      }
      menu.parentNode.removeChild(menu);
    });
    deleteBtn.addEventListener("click", function() {
      const parentComment = event.target.closest(".review-item");
      if (parentComment) {
        const commentId = parentComment.dataset.itemId;
        parentComment.parentNode.removeChild(parentComment);
        const marker = document.querySelector(`#topicContent .comment-marker[data-comment-id="${commentId}"]`);
        if (marker) {
          marker.outerHTML = marker.textContent;
        }
        annotationMap.delete(commentId);
        reviewItems = reviewItems.filter(item => item.id !== commentId);
        saveAnnotationToServer({ id: commentId, type: 'delete' }, currentTopic);
      }
      menu.parentNode.removeChild(menu);
    });
    document.addEventListener("click", function handler(ev) {
      if (!menu.contains(ev.target)) {
        if (menu.parentNode) {
          menu.parentNode.removeChild(menu);
        }
        document.removeEventListener("click", handler);
      }
    });
  }
});

// --- Function to Save an Annotation to the Server ---
function saveAnnotationToServer(changeObj, topic) {
  console.log("Calling saveAnnotationToServer");
  if (!topic) {
    topic = "default";
  }
  fetch('/saveReviewChange', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      webhelpId: webhelpId,
      version: version,
      topic: topic,
      change: changeObj
    })
  })
  .then(response => response.json())
  .then(data => {
    console.log("Annotation saved on server:", data);
  })
  .catch(error => {
    console.error("Error saving annotation to server:", error);
  });
}
