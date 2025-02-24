function updateGlobalActiveUsersDisplay() {
  const container = document.getElementById('globalActiveUsers');
  if (!container) return;
  container.innerHTML = '';
  Object.values(globalActiveUsers).forEach(userObj => {
    const userDiv = document.createElement('div');
    userDiv.className = 'global-user';
    userDiv.textContent = userObj.user.charAt(0).toUpperCase();
    userDiv.title = userObj.user;
    container.appendChild(userDiv);
  });
}

/************************************************
 * Advanced Serialization Helper Functions
 ************************************************/
function getXPathForNode(node, root) {
  if (node === root) return ".";
  let parts = [];
  while (node && node !== root) {
    if (node.nodeType === Node.TEXT_NODE) {
      let index = 1;
      let sibling = node.previousSibling;
      while (sibling) {
        if (sibling.nodeType === Node.TEXT_NODE) index++;
        sibling = sibling.previousSibling;
      }
      parts.unshift(`text()[${index}]`);
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      let index = 1;
      let sibling = node.previousSibling;
      while (sibling) {
        if (sibling.nodeType === Node.ELEMENT_NODE && sibling.nodeName === node.nodeName) index++;
        sibling = sibling.previousSibling;
      }
      parts.unshift(node.nodeName.toLowerCase() + `[${index}]`);
    }
    node = node.parentNode;
  }
  return "./" + parts.join("/");
}

function getNodeByXPath(xpath, root) {
  let evaluator = new XPathEvaluator();
  let result = evaluator.evaluate(xpath, root, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
  return result.singleNodeValue;
}

function advancedSerializeRange(range) {
  let commonAncestor = range.commonAncestorContainer;
  if (commonAncestor.nodeType === Node.TEXT_NODE) {
    commonAncestor = commonAncestor.parentNode;
  }
  if (commonAncestor && (commonAncestor.tagName === "OL" || commonAncestor.tagName === "UL")) {
    const liElements = Array.from(commonAncestor.getElementsByTagName("li")).filter(li => {
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

function serializeRange(range) {
  return advancedSerializeRange(range);
}

function deserializeRange(serialized) {
  return advancedDeserializeRange(serialized);
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
      const topicUrl = `/webhelp/${webhelpId}/${currentVersion}/${subFolder}/${href}`;
      fetch(topicUrl)
        .then(resp => {
          if (!resp.ok) throw new Error("Network response was not ok: " + resp.statusText);
          return resp.text();
        })
        .then(newTopicHtml => {
          topicDiv.innerHTML = newTopicHtml;
          overrideTopicLinks();
          loadAnnotationsFromServer(currentTopic);
        })
        .catch(err => console.error("Error loading linked topic:", err));
    });
  });
}

function isHeadingElement(elem) {
  return elem && elem.tagName && /^H[1-6]$/.test(elem.tagName);
}

function reapplyCommentMarker(annotation) {
  if (!annotation.range) return;
  const range = advancedDeserializeRange(annotation.range);
  if (range) {
    const marker = document.createElement("span");
    marker.className = "comment-marker";
    marker.dataset.commentId = annotation.id;
    marker.innerHTML = annotation.range.html || range.toString();
    try {
      range.surroundContents(marker);
      annotationMap.set(annotation.id, marker);
    } catch (e) {
      console.error("Error reapplying comment marker:", e);
    }
  }
}

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

function formatTimestamp(ts) {
  const d = new Date(ts);
  if (isNaN(d)) return ts;
  return d.toLocaleDateString(undefined, { month: '2-digit', day: '2-digit' }) + ", " +
         d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function createReviewItem(type, data) {
  const item = document.createElement('div');
  item.classList.add('annotation-entry', 'review-item', type);
  item.dataset.itemId = data.id;
  item.dataset.type = type;
  if (data.range) {
    item.dataset.range = JSON.stringify(data.range);
  }

  let content = "";
  if (type === 'comment') {
    content = data.text;
  } else if (type === 'deletion') {
    content = "Deleted: <span class='deleted-text'>" + (data.deletedText || data.deletedHtml || "") + "</span>";
  } else if (type === 'highlight') {
    content = "Highlighted: <span class='text-highlight'>" + (data.highlightedText || data.highlightedHtml || "") + "</span>";
  } else if (type === 'replacement') {
    content = `<div>Replaced: <span class="deleted-text">${data.oldText || data.oldHtml || ""}</span></div>
               <div>With: <span class="replacement-text">${data.newText}</span></div>`;
  } else {
    return null; // Ignore unrecognized types like 'needs-review-element'
  }

  let versionInfo = "";
  if (data.version) {
    versionInfo = `<div class="annotation-version">Version: ${data.version}</div>`;
  }

  item.innerHTML = `
    <div class="annotation-header author">
      <div class="author-info">
        <div class="annotation-username username">${data.user}</div>
        <div class="annotation-timestamp timestamp">${formatTimestamp(data.timestamp)}</div>
        ${versionInfo}
      </div>
      <button class="ellipsis-btn">…</button>
    </div>
    <div class="annotation-content text">${content}</div>
    <div class="reply-container"></div>
    <div class="inline-reply">
      <textarea class="reply-textarea" placeholder="Reply"></textarea>
      <div class="reply-buttons">
        <button class="reply-cancel small-btn" disabled>Cancel</button>
        <button class="reply-post small-btn" disabled>Post</button>
      </div>
    </div>
  `;

  return item;
}

function createReplyItem(data) {
  const replyItem = document.createElement('div');
  replyItem.classList.add('reply-item');
  replyItem.dataset.itemId = data.id;
  replyItem.innerHTML = `
    <div class="annotation-header reply-header">
      <div class="author-info">
        <div class="annotation-username username">${data.user}</div>
        <div class="annotation-timestamp timestamp">${formatTimestamp(data.timestamp)}</div>
      </div>
      <button class="reply-edit-btn small-btn">Edit</button>
    </div>
    <div class="annotation-content text reply-text">${data.text}</div>
  `;
  return replyItem;
}

function paginateReplies(replyContainer) {
  const batchSize = 2;
  const replyItems = Array.from(replyContainer.querySelectorAll('.reply-item'));
  if (replyItems.length > batchSize) {
    replyItems.slice(batchSize).forEach(reply => {
      reply.style.display = 'none';
    });
    const viewMoreBtn = document.createElement('button');
    viewMoreBtn.textContent = 'View More';
    viewMoreBtn.classList.add('view-more-btn', 'small-btn');
    replyContainer.appendChild(viewMoreBtn);
    
    viewMoreBtn.addEventListener('click', () => {
      const hiddenReplies = replyItems.filter(reply => reply.style.display === 'none');
      const toShow = hiddenReplies.slice(0, batchSize);
      toShow.forEach(reply => reply.style.display = 'block');
      if (replyItems.every(reply => reply.style.display !== 'none')) {
        viewMoreBtn.remove();
      }
    });
  }
}

function addAnnotationStatusIcon(annotationItem, statusType) {
  let existing = annotationItem.querySelector('.annotation-status');
  if (existing) existing.remove();
  const statusDiv = document.createElement('div');
  statusDiv.classList.add('annotation-status');
  if (statusType === 'accepted') {
    statusDiv.textContent = '👍';
    statusDiv.classList.add('status-accepted');
  } else if (statusType === 'rejected') {
    statusDiv.textContent = '👎';
    statusDiv.classList.add('status-rejected');
  }
  annotationItem.style.position = 'relative';
  statusDiv.style.position = 'absolute';
  statusDiv.style.bottom = '8px';
  statusDiv.style.left = '8px';
  statusDiv.style.fontSize = '1.2em';
  annotationItem.appendChild(statusDiv);
}

function revertAnnotationText(annotationType, annotationId) {
  if (annotationType === 'comment') {
    const marker = document.querySelector(`.comment-marker[data-comment-id="${annotationId}"]`);
    if (marker) marker.outerHTML = marker.textContent;
  } else if (annotationType === 'highlight') {
    const hlSpan = document.querySelector(`[data-highlight-id="${annotationId}"]`);
    if (hlSpan) hlSpan.outerHTML = hlSpan.textContent;
  } else if (annotationType === 'deletion') {
    const deletedSpan = document.querySelector(`[data-deletion-id="${annotationId}"]`);
    if (deletedSpan) deletedSpan.outerHTML = deletedSpan.textContent;
  } else if (annotationType === 'replacement') {
    const replacedItem = document.querySelector(`[data-deletion-id="${annotationId}"]`);
    if (replacedItem) {
      replacedItem.nextSibling?.remove();
      const inserted = replacedItem.nextSibling;
      if (inserted && inserted.classList.contains('inserted-text')) inserted.remove();
      replacedItem.outerHTML = replacedItem.textContent;
    }
  }
}

function loadAnnotationsFromServer(topic, includePrevious = false, baseVersion = null, filterParams = {}) {
  if (!topic) topic = "default";
  currentTopic = topic;
  localStorage.setItem("currentTopic", currentTopic);
  let versionToUse = baseVersion ? baseVersion : version;
  let url = `/getReviewChanges/${webhelpId}/${versionToUse}/${encodeURIComponent(topic)}`;
  if (includePrevious) url += '?includePrevious=true';

  fetch(url)
    .then(response => response.json())
    .then(flatAnnotations => {
      flatAnnotations.forEach(a => {
        if (!a.version) a.version = versionToUse;
      });
      
      const applyFilters = annotation => {
        for (let [key, value] of Object.entries(filterParams)) {
          if (annotation[key] !== value) return false;
        }
        return true;
      };

      const annotationsMap = {};
      flatAnnotations.forEach(a => {
        annotationsMap[a.id] = a;
        a.replies = [];
      });
      const topAnnotations = [];
      flatAnnotations.forEach(a => {
        if (!applyFilters(a)) return;
        if (a.parentId) {
          if (annotationsMap[a.parentId]) annotationsMap[a.parentId].replies.push(a);
        } else {
          topAnnotations.push(a);
        }
      });

      const reviewList = document.getElementById("reviewList");
      reviewList.innerHTML = "";
      reviewItems = [];
      topAnnotations.forEach(a => {
        if (a.status === "deleted" || a.status === "resolved") return;
        const item = createReviewItem(a.type, a);
        if (item) {
          if (a.type === 'comment' && a.range) reapplyCommentMarker(a);
          else if (a.type === 'deletion' && a.range) reapplyDeletionMarker(a);
          else if (a.type === 'highlight' && a.range) reapplyHighlightMarker(a);
          else if (a.type === 'replacement' && a.range) reapplyReplacementMarker(a);
          if (a.status === "accepted") addAnnotationStatusIcon(item, "accepted");
          else if (a.status === "rejected") addAnnotationStatusIcon(item, "rejected");
          if (a.replies && a.replies.length > 0) {
            const replyContainer = item.querySelector('.reply-container');
            if (replyContainer) {
              a.replies.forEach(reply => {
                if (!applyFilters(reply) || reply.status === "deleted" || reply.status === "resolved") return;
                const replyItem = createReplyItem(reply);
                replyContainer.appendChild(replyItem);
                reviewItems.push(reply);
              });
              paginateReplies(replyContainer);
            }
          }
          reviewList.appendChild(item);
          reviewItems.push(a);
        }
      });
    })
    .catch(error => console.error("Error loading annotations from server:", error));
}

function saveAnnotationToServer(changeObj, topic) {
  if (!topic) topic = "default";
  socket.emit('annotation-change', {
    room: 'document-' + webhelpId + '-' + currentVersion,
    id: socket.id,
    change: changeObj,
    topic: topic
  });

  fetch('/saveReviewChange', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      webhelpId: webhelpId,
      version: currentVersion,
      topic: topic,
      change: changeObj
    })
  })
    .then(response => response.json())
    .then(data => console.log("Annotation saved on server:", data))
    .catch(error => console.error("Error saving annotation to server:", error));
}

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

function updateTOCWithReviewStatus() {
  fetch(`/getTopicsForReview/${webhelpId}/${currentVersion}`)
    .then(response => response.json())
    .then(reviews => {
      const tocLinks = document.querySelectorAll('#tocList a, #tocList .tocItem');
      tocLinks.forEach(link => {
        const topic = link.getAttribute('href')?.replace('.html', '') || link.textContent.replace(/\s/g, '');
        if (reviews[topic]?.needsReview) {
          link.classList.add('needs-review');
        } else {
          link.classList.remove('needs-review');
        }
      });
    })
    .catch(err => console.error("Error syncing TOC review status:", err));
}