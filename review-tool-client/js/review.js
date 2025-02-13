/************************************************
     * Global Variables and Topic Identification
     ************************************************/
const params = new URLSearchParams(window.location.search);
const webhelpId = params.get("webhelpId");
const version = params.get("version");
const subFolder = params.get("subFolder");
// Retrieve current topic from localStorage; default to "default".
let currentTopic = localStorage.getItem("currentTopic") || "default";

/***************************************
 * TOC & Topic Loading
 ***************************************/
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
      // Extract nested TOC from <nav><ul class="map bookmap">
      const tocElement = tempDiv.querySelector("nav ul.map");
      if (tocElement) {
        tocList.innerHTML = tocElement.outerHTML;
        const tocLinks = tocList.querySelectorAll("a");
        tocLinks.forEach(link => {
          link.addEventListener("click", function(event) {
            event.preventDefault();
            // Use the href (without ".html") as the topic identifier.
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
          // If a topic was previously saved, try to click that link; otherwise, click the first.
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
        // Fallback: Build TOC from all <h2> headings.
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

// Override default behavior of links within topic content so they load via AJAX.
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

/******************************************************
 * Annotation, Context Menu, and Review Panel Features
 ******************************************************/
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

// --- Range Serialization Functions ---
function serializeRange(range) {
  const fullText = topicContent.textContent;
  const text = range.toString();
  const startOffset = fullText.indexOf(text);
  const endOffset = startOffset + text.length;
  return { text, startOffset, endOffset };
}
function deserializeRange(serialized) {
  const fullText = topicContent.textContent;
  const { text, startOffset, endOffset } = serialized;
  if (fullText.substring(startOffset, endOffset) !== text) return null;
  const range = document.createRange();
  let charCount = 0, startNode, endNode;
  const treeWalker = document.createTreeWalker(topicContent, NodeFilter.SHOW_TEXT);
  while (treeWalker.nextNode()) {
    const node = treeWalker.currentNode;
    const nodeLength = node.textContent.length;
    if (charCount + nodeLength >= startOffset) {
      startNode = node;
      break;
    }
    charCount += nodeLength;
  }
  charCount = 0;
  treeWalker.currentNode = topicContent;
  while (treeWalker.nextNode()) {
    const node = treeWalker.currentNode;
    const nodeLength = node.textContent.length;
    if (charCount + nodeLength >= endOffset) {
      endNode = node;
      break;
    }
    charCount += nodeLength;
  }
  if (!startNode || !endNode) return null;
  range.setStart(startNode, startOffset - charCount);
  range.setEnd(endNode, endOffset - charCount);
  return range;
}

// --- Reapply a comment marker based on stored range ---
function reapplyCommentMarker(annotation) {
  if (!annotation.range) return;
  const range = deserializeRange(annotation.range);
  if (range) {
    const marker = document.createElement("span");
    marker.className = "comment-marker";
    marker.dataset.commentId = annotation.id;
    marker.textContent = range.toString();
    try {
      range.surroundContents(marker);
      annotationMap.set(annotation.id, marker);
    } catch (e) {
      console.error("Error reapplying comment marker:", e);
    }
  }
}

// --- Reapply a deletion marker based on stored range ---
function reapplyDeletionMarker(annotation) {
  if (!annotation.range) return;
  const range = deserializeRange(annotation.range);
  if (range) {
    const marker = document.createElement("span");
    marker.className = "deleted-text";
    marker.textContent = annotation.deletedText;
    try {
      range.deleteContents();
      range.insertNode(marker);
    } catch (e) {
      console.error("Error reapplying deletion marker:", e);
    }
  }
}

// --- Reapply a highlight marker based on stored range ---
function reapplyHighlightMarker(annotation) {
  if (!annotation.range) return;
  const range = deserializeRange(annotation.range);
  if (range) {
    const marker = document.createElement("span");
    marker.className = "annotator-hl";
    marker.textContent = annotation.highlightedText || range.toString();
    try {
      range.deleteContents();
      range.insertNode(marker);
    } catch (e) {
      console.error("Error reapplying highlight marker:", e);
    }
  }
}

// --- Reapply a replacement marker based on stored range ---
function reapplyReplacementMarker(annotation) {
  if (!annotation.range) return;
  const range = deserializeRange(annotation.range);
  if (range) {
    const deletedSpan = document.createElement("span");
    deletedSpan.className = "deleted-text";
    deletedSpan.textContent = annotation.oldText;
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
}

// --- Load annotations from the server for the current topic ---
function loadAnnotationsFromServer(topic) {
  if (!topic) topic = "default";
  currentTopic = topic;
  localStorage.setItem("currentTopic", currentTopic);
  // Use encodeURIComponent in case the topic contains slashes.
  fetch(`/getReviewChanges/${webhelpId}/${version}/${encodeURIComponent(topic)}`)
    .then(response => response.json())
    .then(flatAnnotations => {
      // Build a nested structure from the flat array.
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

// --- Listen for text selection in topicContent ---
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

// --- Create a review item for the review panel ---
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
        <div class="deletion-text">Deleted: ${data.deletedText}</div>
      `;
      break;
    case 'highlight':
      item.innerHTML = `
        <div class="replacement-meta">
          <strong>${data.user}</strong>
          <small>${data.timestamp}</small>
        </div>
        <div class="replacement-content">
          Highlighted: <span class="text-highlight">${data.highlightedText}</span>
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
          <div>Replaced: <span class="deleted-text">${data.oldText}</span></div>
          <div>With: <span class="replacement-text">${data.newText}</span></div>
        </div>
      `;
      break;
  }
  return item;
}

// --- Submit Comment Handler ---
document.getElementById('submitComment').addEventListener('click', () => {
  const text = document.getElementById('commentText').value.trim();
  if (text && selectedRange) {
    const commentId = Date.now().toString();
    const serialized = serializeRange(selectedRange.cloneRange());
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
    commentSpan.textContent = selectedText;
    selectedRange.deleteContents();
    selectedRange.insertNode(commentSpan);
    annotationMap.set(commentId, commentSpan);
    const reviewItem = document.createElement('div');
    reviewItem.className = "review-item comment";
    reviewItem.dataset.itemId = commentId;
    reviewItem.dataset.type = 'comment';
    reviewItem.innerHTML = `
      <div class="author">
        ${comment.user} <span class="timestamp">${comment.timestamp}</span> <button class="ellipsis-btn">⋮</button>
      </div>
      <div class="text">${comment.text}</div>
      <div class="comment-actions">
        <button class="reply-btn">Reply</button>
      </div>
      <div class="replies"></div>
    `;
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
    const highlight = {
      id: Date.now().toString(),
      type: 'highlight',
      user: currentUserAnnotation,
      highlightedText: selectedText,
      timestamp: new Date().toLocaleString(),
      range: serializeRange(selectedRange.cloneRange())
    };
    const span = document.createElement('span');
    span.className = 'annotator-hl';
    span.textContent = selectedText;
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
    const deletion = {
      id: Date.now().toString(),
      type: 'deletion',
      user: currentUserAnnotation,
      deletedText: selectedText,
      timestamp: new Date().toLocaleString(),
      range: serializeRange(selectedRange.cloneRange())
    };
    const span = document.createElement('span');
    span.className = 'deleted-text';
    span.textContent = selectedText;
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

// --- Show Comment Modal ---
document.getElementById('commentButton').addEventListener('click', () => {
  showModal('speechBubble');
});

// --- Show Replace Modal ---
document.getElementById('replaceButton').addEventListener('click', () => {
  document.getElementById('replaceFrom').value = selectedText;
  showModal('replaceModal');
});

// --- Replace Functionality ---
document.getElementById('replaceConfirm').addEventListener('click', () => {
  const newText = document.getElementById('replaceTo').value.trim();
  if (newText && selectedRange) {
    const replacement = {
      id: Date.now().toString(),
      type: 'replacement',
      user: currentUserAnnotation,
      oldText: selectedText,
      newText: newText,
      timestamp: new Date().toLocaleString(),
      range: serializeRange(selectedRange.cloneRange())
    };
    const deletedSpan = document.createElement('span');
    deletedSpan.className = 'deleted-text';
    deletedSpan.textContent = selectedText;
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
