document.addEventListener('DOMContentLoaded', function() {
  /************************************************
   * Global Variables and Topic Identification
   ************************************************/
  const params = new URLSearchParams(window.location.search);
  const webhelpId = params.get("webhelpId");
  const version = params.get("version"); // e.g. "v2"
  const subFolder = params.get("subFolder");
  let showPreviousComments = false;
  let currentTopic = localStorage.getItem("currentTopic") || "default";
  let newAnnotationCount = 0;
  
  let selectedText = '';
  let selectedRange = null;
  
  const globalActiveUsers = {};  
  const currentUserAnnotation = localStorage.getItem("currentUser") || "User1";
  
  const topicContent = document.getElementById("topicContent");
  let currentVersion = version;
  
  /************************************************
   * Version Selector Setup
   ************************************************/
  const currentVersionNum = parseInt(version.substring(1)) || 1;
  const versionSelect = document.getElementById("versionSelect");
  versionSelect.innerHTML = "";
  for (let i = 1; i <= currentVersionNum; i++) {
    const opt = document.createElement("option");
    opt.value = "v" + i;
    opt.textContent = "v" + i;
    versionSelect.appendChild(opt);
  }
  if (currentVersionNum > 1) {
    const allOpt = document.createElement("option");
    allOpt.value = "all";
    allOpt.textContent = "All Versions";
    versionSelect.appendChild(allOpt);
  }
  versionSelect.value = version;
  
  loadAnnotationsFromServer(currentTopic, false, version);
  
  /************************************************
   * Socket.IO Integration
   ************************************************/
  const socket = io();
  socket.on('connect', () => {
    console.log('Connected to Socket.IO server:', socket.id);
    const room = 'document-' + webhelpId + '-' + currentVersion;
    socket.emit('joinRoom', room);
    globalActiveUsers[socket.id] = { user: currentUserAnnotation, lastUpdate: Date.now() };
    updateGlobalActiveUsersDisplay();
  });
  
  socket.on('cursor-update', (data) => {
    console.log('Received cursor update:', data);
  });
  
  /************************************************
   * Global and Topic Cursor Indicators
   ************************************************/
  const topicCursorMarkers = {};
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
  
  const otherCursorMarkers = {};
  socket.on('cursor-update', (data) => {
    if (data.id === socket.id) return;
    globalActiveUsers[data.id] = { user: data.user, lastUpdate: Date.now() };
    updateGlobalActiveUsersDisplay();
    if (data.currentTopic === currentTopic) {
      let marker = topicCursorMarkers[data.id];
      if (!marker) {
        marker = document.createElement('div');
        marker.className = 'topic-cursor-marker';
        const label = document.createElement('div');
        label.className = 'cursor-label';
        label.textContent = data.user;
        marker.appendChild(label);
        topicContent.appendChild(marker);
        topicCursorMarkers[data.id] = marker;
      }
      const rect = topicContent.getBoundingClientRect();
      marker.style.left = (data.cursorX - rect.left) + 'px';
      marker.style.top = (data.cursorY - rect.top) + 'px';
      marker.dataset.lastUpdate = Date.now();
    } else {
      if (topicCursorMarkers[data.id]) {
        topicCursorMarkers[data.id].remove();
        delete topicCursorMarkers[data.id];
      }
    }
  });
  
  setInterval(() => {
    const now = Date.now();
    Object.keys(globalActiveUsers).forEach(id => {
      if (id !== socket.id && now - globalActiveUsers[id].lastUpdate > 5000) {
        delete globalActiveUsers[id];
      }
    });
    updateGlobalActiveUsersDisplay();
    Object.keys(topicCursorMarkers).forEach(id => {
      const marker = topicCursorMarkers[id];
      if (now - marker.dataset.lastUpdate > 5000) {
        marker.remove();
        delete topicCursorMarkers[id];
      }
    });
  }, 5000);
  
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
              const topicUrl = `/webhelp/${webhelpId}/${currentVersion}/${subFolder}/${href}`;
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
          const tocList = document.getElementById("tocList");
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
                const topicUrl = `/webhelp/${webhelpId}/${currentVersion}/${subFolder}/topic${idx + 1}.html`;
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
        const topicUrl = `/webhelp/${webhelpId}/${currentVersion}/${subFolder}/${href}`;
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
  const contextMenu = document.getElementById("contextMenu");
  const overlay = document.getElementById("overlay");
  let currentReplyTarget = null;
  let currentEditTarget = null;
  const annotationMap = new Map();
  let reviewItems = [];
  
  topicContent.addEventListener('mousemove', (event) => {
    const room = 'document-' + webhelpId + '-' + currentVersion;
    socket.emit('cursor-update', { 
      room, 
      cursorX: event.clientX, 
      cursorY: event.clientY, 
      user: currentUserAnnotation, 
      currentTopic: currentTopic 
    });
  });
  
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
  
  // loadAnnotationsFromServer now uses the provided baseVersion.
  function loadAnnotationsFromServer(topic, includePrevious = false, baseVersion = null) {
    if (!topic) topic = "default";
    currentTopic = topic;
    localStorage.setItem("currentTopic", currentTopic);
    let versionToUse = baseVersion ? baseVersion : version;
    let url = `/getReviewChanges/${webhelpId}/${versionToUse}/${encodeURIComponent(topic)}`;
    if (includePrevious) {
      url += '?includePrevious=true';
    }
    fetch(url)
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
          // Skip rendering if annotation is marked deleted or resolved
          if (a.status === "deleted" || a.status === "resolved") {
            return;
          }
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
          // If status is accepted or rejected, add status icon
          if (a.status === "accepted") {
            addAnnotationStatusIcon(item, "accepted");
          } else if (a.status === "rejected") {
            addAnnotationStatusIcon(item, "rejected");
          }
  
          if (a.replies && a.replies.length > 0) {
            const replyContainer = item.querySelector('.reply-container');
            if (replyContainer) {
              a.replies.forEach(reply => {
                if (reply.status === "deleted" || reply.status === "resolved") return;
                const replyItem = createReplyItem(reply);
                replyContainer.appendChild(replyItem);
                reviewItems.push(reply);
              });
              paginateReplies(replyContainer);
            }
          }
  
          reviewList.appendChild(item);
          reviewItems.push(a);
        });
      })
      .catch(error => {
        console.error("Error loading annotations from server:", error);
      });
  }
  
  window.addEventListener("load", () => {
    loadAnnotationsFromServer(currentTopic);
  });
  
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
  
  versionSelect.addEventListener("change", function() {
    const selected = this.value;
    if (selected === "all") {
      currentVersion = version;
      loadAnnotationsFromServer(currentTopic, true, currentVersion);
    } else {
      currentVersion = selected;
      loadAnnotationsFromServer(currentTopic, false, currentVersion);
    }
  });
  
  // Helper function to format the timestamp
  function formatTimestamp(ts) {
    const d = new Date(ts);
    if (isNaN(d)) return ts;
    return d.toLocaleDateString(undefined, { month: '2-digit', day: '2-digit' }) + ", " +
           d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
  
  function createReviewItem(type, data) {
    const item = document.createElement('div');
    // Add the type as a class so that CSS rules (e.g., .review-item.comment) apply
    item.classList.add('annotation-entry', 'review-item', type);
    item.dataset.itemId = data.id;
    item.dataset.type = type;
    
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
    }
    
    item.innerHTML = `
      <div class="annotation-header author">
        <div class="author-info">
          <div class="annotation-username username">${data.user}</div>
          <div class="annotation-timestamp timestamp">${formatTimestamp(data.timestamp)}</div>
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
  
  // Ellipsis menu with options: Edit, Delete, Accept, Reject, Resolve
  document.addEventListener("click", function(event) {
    if (event.target && event.target.classList.contains("ellipsis-btn")) {
      event.stopPropagation();
      const existingMenu = document.querySelector(".comment-options-menu");
      if (existingMenu) {
        existingMenu.parentNode.removeChild(existingMenu);
        return;
      }
      const parentAnnotation = event.target.closest(".review-item");
      if (!parentAnnotation) return;
      const annotationType = parentAnnotation.dataset.type;
      const annotationId = parentAnnotation.dataset.itemId;
      
      const menu = document.createElement("div");
      menu.className = "comment-options-menu";
      menu.style.position = "fixed";
      menu.style.background = "white";
      menu.style.border = "1px solid #ccc";
      menu.style.boxShadow = "2px 2px 5px rgba(0,0,0,0.2)";
      menu.style.padding = "2px";
      menu.style.zIndex = "2000";
      menu.style.opacity = "0";
      menu.style.transition = "opacity 0.2s ease, transform 0.2s ease";
      
      const editBtn = document.createElement("button");
      editBtn.textContent = "Edit";
      editBtn.style.margin = "2px 0";
      
      const deleteBtn = document.createElement("button");
      deleteBtn.textContent = "Delete";
      deleteBtn.style.margin = "2px 0";
      
      const acceptBtn = document.createElement("button");
      acceptBtn.textContent = "Accept";
      acceptBtn.style.margin = "2px 0";
      
      const rejectBtn = document.createElement("button");
      rejectBtn.textContent = "Reject";
      rejectBtn.style.margin = "2px 0";
      
      const resolveBtn = document.createElement("button");
      resolveBtn.textContent = "Resolve";
      resolveBtn.style.margin = "2px 0";
      
      if (annotationType === "comment") {
        menu.appendChild(editBtn);
      }
      menu.appendChild(deleteBtn);
      menu.appendChild(acceptBtn);
      menu.appendChild(rejectBtn);
      menu.appendChild(resolveBtn);
      
      const rect = event.target.getBoundingClientRect();
      const menuWidth = 150;
      if (rect.right + menuWidth > window.innerWidth) {
        menu.style.left = (rect.left - menuWidth + 2) + "px";
      } else {
        menu.style.left = (rect.right - 2) + "px";
      }
      menu.style.top = (rect.top + 2) + "px";
      
      document.body.appendChild(menu);
      requestAnimationFrame(() => {
        menu.style.opacity = "1";
        menu.style.transform = "translateY(0px)";
      });
      
      editBtn.addEventListener("click", function() {
        const textElem = parentAnnotation.querySelector(".text");
        if (textElem) {
          document.getElementById('editText').value = textElem.textContent;
        }
        currentEditTarget = parentAnnotation;
        showModal('editModal');
        removeMenu();
      });
      
      deleteBtn.addEventListener("click", function() {
        // Mark annotation as deleted
        const annotationObj = reviewItems.find(item => item.id === annotationId);
        if (annotationObj) {
          annotationObj.status = "deleted";
        }
        parentAnnotation.remove();
        revertAnnotationText(annotationType, annotationId);
        annotationMap.delete(annotationId);
        reviewItems = reviewItems.filter(item => item.id !== annotationId);
        saveAnnotationToServer(annotationObj, currentTopic);
        removeMenu();
      });
      
      acceptBtn.addEventListener("click", function() {
        const annotationObj = reviewItems.find(item => item.id === annotationId);
        if (annotationObj) {
          annotationObj.status = "accepted";
        }
        addAnnotationStatusIcon(parentAnnotation, "accepted");
        saveAnnotationToServer(annotationObj, currentTopic);
        removeMenu();
      });
      
      rejectBtn.addEventListener("click", function() {
        const annotationObj = reviewItems.find(item => item.id === annotationId);
        if (annotationObj) {
          annotationObj.status = "rejected";
        }
        addAnnotationStatusIcon(parentAnnotation, "rejected");
        saveAnnotationToServer(annotationObj, currentTopic);
        removeMenu();
      });
      
      resolveBtn.addEventListener("click", function() {
        const annotationObj = reviewItems.find(item => item.id === annotationId);
        if (annotationObj) {
          annotationObj.status = "resolved";
        }
        parentAnnotation.style.display = "none";
        saveAnnotationToServer(annotationObj, currentTopic);
        removeMenu();
      });
      
      document.addEventListener("click", function handler(ev) {
        if (!menu.contains(ev.target)) {
          removeMenu();
          document.removeEventListener("click", handler);
        }
      });
      
      function removeMenu() {
        if (menu.parentNode) {
          menu.parentNode.removeChild(menu);
        }
      }
    }
  });
  
  function addAnnotationStatusIcon(annotationItem, statusType) {
    let existing = annotationItem.querySelector('.annotation-status');
    if (existing) {
      existing.remove();
    }
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
      if (marker) {
        marker.outerHTML = marker.textContent;
      }
    } else if (annotationType === 'highlight') {
      const hlSpan = document.querySelector(`[data-highlight-id="${annotationId}"]`);
      if (hlSpan) {
        hlSpan.outerHTML = hlSpan.textContent;
      }
    } else if (annotationType === 'deletion') {
      const deletedSpan = document.querySelector(`[data-deletion-id="${annotationId}"]`);
      if (deletedSpan) {
        deletedSpan.outerHTML = deletedSpan.textContent;
      }
    } else if (annotationType === 'replacement') {
      const replacedItem = document.querySelector(`[data-deletion-id="${annotationId}"]`);
      if (replacedItem) {
        replacedItem.nextSibling?.remove();
        const inserted = replacedItem.nextSibling;
        if (inserted && inserted.classList.contains('inserted-text')) {
          inserted.remove();
        }
        replacedItem.outerHTML = replacedItem.textContent;
      }
    }
  }

  // Listen for annotation changes from other clients.
// When another client makes a change, we reload annotations.
socket.on('annotation-change', (data) => {
  // Ignore events sent by this client.
  if (data.id === socket.id) return;
  // If the change is not for the current topic, ignore it.
  if (data.topic && data.topic !== currentTopic) return;
  console.log('Received annotation change from another client:', data);
  newAnnotationCount++;
  updateCheckCommentsButton();
});


const checkCommentsButton = document.getElementById("checkCommentsButton");
checkCommentsButton.addEventListener("click", function() {
  loadAnnotationsFromServer(currentTopic);
  newAnnotationCount = 0;
  updateCheckCommentsButton();
});

function updateCheckCommentsButton() {
  if (newAnnotationCount > 0) {
    checkCommentsButton.textContent = `Check for comments (${newAnnotationCount})`;
  } else {
    checkCommentsButton.textContent = "Check for comments";
  }
}

  
  /*
  function saveAnnotationToServer(changeObj, topic) {
    console.log("Calling saveAnnotationToServer", changeObj);
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
        version: currentVersion,
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
  }*/
 // In your saveAnnotationToServer function, add an emit so that changes
// are sent to other clients in the same room.
function saveAnnotationToServer(changeObj, topic) {
  if (!topic) topic = "default";

  // Emit the change to other clients for concurrency.
  socket.emit('annotation-change', {
    room: 'document-' + webhelpId + '-' + currentVersion,
    id: socket.id,
    change: changeObj,
    topic: topic // include the current topic
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
    .then(data => {
      console.log("Annotation saved on server:", data);
    })
    .catch(error => {
      console.error("Error saving annotation to server:", error);
    });
}
  
  // Inline Reply & Edit Handlers (unchanged)
  document.getElementById('reviewList').addEventListener('input', function(event) {
    if (event.target.classList.contains('reply-textarea')) {
      const inlineReplyDiv = event.target.closest('.inline-reply');
      const postBtn = inlineReplyDiv.querySelector('.reply-post');
      const cancelBtn = inlineReplyDiv.querySelector('.reply-cancel');
      if (event.target.value.trim().length > 0) {
        postBtn.disabled = false;
        cancelBtn.disabled = false;
        postBtn.style.fontWeight = 'bold';
      } else {
        postBtn.disabled = true;
        cancelBtn.disabled = true;
        postBtn.style.fontWeight = 'normal';
      }
    }
    if (event.target.classList.contains('reply-edit-textarea')) {
      const editContainer = event.target.closest('.reply-edit-container');
      const saveBtn = editContainer.querySelector('.reply-edit-save');
      if (event.target.value.trim().length > 0) {
        saveBtn.disabled = false;
        saveBtn.style.fontWeight = 'bold';
      } else {
        saveBtn.disabled = true;
        saveBtn.style.fontWeight = 'normal';
      }
    }
  });
  
  document.getElementById('reviewList').addEventListener('click', function(event) {
    if (event.target.classList.contains('reply-edit-btn')) {
      const replyItem = event.target.closest('.reply-item');
      const replyTextDiv = replyItem.querySelector('.reply-text');
      replyTextDiv.style.display = 'none';
      let editContainer = replyItem.querySelector('.reply-edit-container');
      if (!editContainer) {
        editContainer = document.createElement('div');
        editContainer.classList.add('reply-edit-container');
        editContainer.innerHTML = `
          <textarea class="reply-edit-textarea">${replyTextDiv.textContent}</textarea>
          <div class="reply-edit-buttons">
            <button class="reply-edit-cancel small-btn">Cancel</button>
            <button class="reply-edit-save small-btn" disabled>Save</button>
          </div>
        `;
        replyItem.appendChild(editContainer);
      } else {
        const textarea = editContainer.querySelector('.reply-edit-textarea');
        textarea.value = replyTextDiv.textContent;
        editContainer.style.display = 'block';
      }
    }
  
    if (event.target.classList.contains('reply-edit-cancel')) {
      const editContainer = event.target.closest('.reply-edit-container');
      editContainer.style.display = 'none';
      const replyItem = event.target.closest('.reply-item');
      const replyTextDiv = replyItem.querySelector('.reply-text');
      replyTextDiv.style.display = 'block';
    }
  
    if (event.target.classList.contains('reply-edit-save')) {
      const editContainer = event.target.closest('.reply-edit-container');
      const textarea = editContainer.querySelector('.reply-edit-textarea');
      const newText = textarea.value.trim();
      if (newText) {
        const replyItem = event.target.closest('.reply-item');
        const replyTextDiv = replyItem.querySelector('.reply-text');
        replyTextDiv.textContent = newText;
        replyTextDiv.style.display = 'block';
        editContainer.style.display = 'none';
      }
    }
  
    if (event.target.classList.contains('reply-post')) {
      const inlineReplyDiv = event.target.closest('.inline-reply');
      const textarea = inlineReplyDiv.querySelector('.reply-textarea');
      const replyText = textarea.value.trim();
      if (replyText) {
        const parentCommentElement = event.target.closest('.review-item');
        const parentId = parentCommentElement.dataset.itemId;
        const reply = {
          id: Date.now().toString(),
          type: 'reply',
          user: currentUserAnnotation,
          text: replyText,
          timestamp: new Date().toLocaleString(),
          parentId: parentId,
        };
        const replyElement = createReplyItem(reply);
        let replyContainer = parentCommentElement.querySelector('.reply-container');
        if (!replyContainer) {
          replyContainer = document.createElement('div');
          replyContainer.className = 'reply-container';
          parentCommentElement.appendChild(replyContainer);
        }
        replyContainer.appendChild(replyElement);
        reviewItems.push(reply);
        saveAnnotationToServer(reply, currentTopic);
        textarea.value = '';
        event.target.disabled = true;
        inlineReplyDiv.querySelector('.reply-cancel').disabled = true;
        event.target.style.fontWeight = 'normal';
      }
    }
  
    if (event.target.classList.contains('reply-cancel')) {
      const inlineReplyDiv = event.target.closest('.inline-reply');
      const textarea = inlineReplyDiv.querySelector('.reply-textarea');
      textarea.value = '';
      const postBtn = inlineReplyDiv.querySelector('.reply-post');
      const cancelBtn = inlineReplyDiv.querySelector('.reply-cancel');
      postBtn.disabled = true;
      cancelBtn.disabled = true;
      postBtn.style.fontWeight = 'normal';
    }
  });
  
  document.getElementById('submitComment').addEventListener('click', () => {
    const text = document.getElementById('commentText').value.trim();
    if (text && selectedRange) {
      const commentId = Date.now().toString();
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
  
  document.getElementById('submitEdit').addEventListener('click', () => {
    const text = document.getElementById('editText').value.trim();
    if (text && currentEditTarget) {
      const textElem = currentEditTarget.querySelector('.text');
      if (textElem) {
        textElem.textContent = text;
      }
      const comment = reviewItems.find(item => item.id === currentEditTarget.dataset.itemId);
      if (comment) comment.text = text;
      saveAnnotationToServer(comment, currentTopic);
      closeModals();
    }
  });
  
  document.getElementById('cancelReply').addEventListener('click', closeModals);
  document.getElementById('cancelEdit').addEventListener('click', closeModals);
  document.getElementById('cancelComment').addEventListener('click', closeModals);
  document.getElementById('replaceCancel').addEventListener('click', closeModals);
  
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
  
  document.getElementById('commentButton').addEventListener('click', () => {
    showModal('speechBubble');
  });
  
  document.getElementById('replaceButton').addEventListener('click', () => {
    document.getElementById('replaceFrom').value = selectedText;
    showModal('replaceModal');
  });
  
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
});
