// Helper function to copy computed styles from one element to another
// Only needed for elements with IDs (classes and inline styles work automatically)
function copyComputedStyles(sourceElement, targetElement) {
  // Important CSS properties to copy (avoid copying everything for performance)
  const propertiesToCopy = [
    "color",
    "backgroundColor",
    "fontSize",
    "fontWeight",
    "fontStyle",
    "fontFamily",
    "textDecoration",
    "textAlign",
    "lineHeight",
    "letterSpacing",
    "wordSpacing",
    "textTransform",
    "borderColor",
    "borderWidth",
    "borderStyle",
    "padding",
    "margin",
    "display",
    "opacity",
    "textShadow",
    "boxShadow"
  ];

  const computed = window.getComputedStyle(sourceElement);

  propertiesToCopy.forEach((prop) => {
    // Use bracket notation to access camelCase properties
    const value = computed[prop];
    if (value && value !== "initial" && value !== "inherit") {
      targetElement.style[prop] = value;
    }
  });
}

// Helper function to get the path to a node
function getNodePath(node, root) {
  const path = [];
  let current = node;

  while (current && current !== root) {
    const parent = current.parentNode;
    if (parent) {
      const index = Array.from(parent.childNodes).indexOf(current);
      path.unshift(index);
    }
    current = parent;
  }

  return path;
}

// Helper function to get a node by path
function getNodeByPath(path, root) {
  let current = root;

  for (const index of path) {
    if (current.childNodes[index]) {
      current = current.childNodes[index];
    } else {
      return null;
    }
  }

  return current;
}

document.addEventListener("DOMContentLoaded", function () {
  const editor = document.getElementById("editor");
  const output = document.getElementById("output");

  let isComposing = false;
  let compositionStartOffset = 0;
  let compositionStartPath = null; // Store path, not node reference
  let compositionData = "";
  let rafId = null; // For throttling updates with requestAnimationFrame
  let range = null;

  // Composition event handlers
  editor.addEventListener("compositionstart", function (e) {
    isComposing = true;
    const selection = window.getSelection();
    if (selection.rangeCount > 0) {
      range = selection.getRangeAt(0);
      compositionStartOffset = range.startOffset;
      // Store the PATH to the node, not the node itself
      // This allows us to find the same node in the cloned content
      compositionStartPath = getNodePath(range.startContainer, editor);
    }
    console.log("Composition started at offset:", compositionStartOffset);
  });

  editor.addEventListener("compositionupdate", function (e) {
    // Don't call updateOutputWithHighlight here!
    // The editor's DOM hasn't been updated yet at this point
    if (isComposing) {
      compositionData = e.data || "";
      console.log("Composition update:", compositionData);
    }
  });

  editor.addEventListener("compositionend", function (e) {
    isComposing = false;
    compositionData = "";
    compositionStartPath = null; // Clear the stored path
    console.log("Composition ended:", e.data);
    // Remove highlighting and show normal output
    updateOutput();
  });

  // Sync scroll positions between editor and output
  editor.addEventListener("scroll", function () {
    output.scrollTop = editor.scrollTop;
    output.scrollLeft = editor.scrollLeft;
  });

  // Also sync when output is scrolled (in case user clicks on it)
  output.addEventListener("scroll", function () {
    editor.scrollTop = output.scrollTop;
    editor.scrollLeft = output.scrollLeft;
  });

  // MutationObserver to catch ALL DOM changes (CON #1 fix)
  // This includes style changes, attribute changes, text changes, etc.
  const observer = new MutationObserver(function (mutations) {
    // Cancel any pending update to batch rapid changes
    if (rafId) {
      cancelAnimationFrame(rafId);
    }

    // Schedule update for next animation frame (max 60fps)
    // This batches multiple mutations and prevents UI jank
    rafId = requestAnimationFrame(() => {
      if (isComposing) {
        // During composition: highlight the composition text
        console.log(
          "DOM changed during composition, highlighting:",
          compositionData
        );
      }
      updateOutput(compositionData);
      rafId = null;
    });
  });

  // Observe the editor for all types of changes
  observer.observe(editor, {
    childList: true, // Watch for added/removed nodes
    subtree: true, // Watch entire subtree
    attributes: true, // Watch for attribute changes (style, class, etc.)
    characterData: true // Watch for text content changes
  });

  function updateOutput(compositionText = null) {
    // Clone the editor's content
    const clonedContent = editor.cloneNode(true);

    // Copy computed styles ONLY for elements with IDs (before stripping)
    // Classes and inline styles work automatically via clone
    clonedContent.querySelectorAll("[id]").forEach((clonedEl) => {
      const sourceEl = editor.querySelector("#" + CSS.escape(clonedEl.id));
      if (sourceEl) {
        copyComputedStyles(sourceEl, clonedEl);
      }
      // Then strip the ID to avoid duplicates
      clonedEl.removeAttribute("id");
    });

    if (isComposing && compositionText && compositionStartPath) {
      // Highlight the composition text in the cloned content
      updateOutputWithHighlight(compositionText, clonedContent);
    }

    output.innerHTML = clonedContent.innerHTML;
  }

  function updateOutputWithHighlight(compositionText, clonedContent) {
    // Use the stored composition start path to find the node
    // Don't use current selection - it moves during IME cycling!
    const targetNode = getNodeByPath(compositionStartPath, clonedContent);

    if (targetNode && compositionText) {
      let textNode = targetNode;
      let parent = null;

      // If targetNode is an element node, find the text node within it
      if (targetNode.nodeType === Node.ELEMENT_NODE) {
        // Find the text node child or the node at the offset
        if (range.startOffset < targetNode.childNodes.length) {
          const childNode = targetNode.childNodes[range.startOffset];
          if (childNode && childNode.nodeType === Node.TEXT_NODE) {
            textNode = childNode;
            parent = targetNode;
          }
        } else if (targetNode.childNodes.length > 0) {
          // Use the last child if it's a text node
          const lastChild =
            targetNode.childNodes[targetNode.childNodes.length - 1];
          if (lastChild && lastChild.nodeType === Node.TEXT_NODE) {
            textNode = lastChild;
            parent = targetNode;
          }
        } else {
          // No text node yet, targetNode is the parent
          textNode = null;
          parent = targetNode;
        }
      } else if (targetNode.nodeType === Node.TEXT_NODE) {
        textNode = targetNode;
        parent = targetNode.parentNode;
      }

      // Handle text node case
      if (textNode && textNode.nodeType === Node.TEXT_NODE && parent) {
        const textContent = textNode.textContent;
        const compositionLength = compositionText.length;

        // Use the FIXED start offset from composition start
        // Don't calculate backwards - that breaks with IME cycling!
        const startOffset = compositionStartOffset;
        const endOffset = startOffset + compositionLength;

        if (startOffset >= 0 && endOffset <= textContent.length) {
          // Split the text node and wrap the composition part
          const beforeText = textContent.substring(0, startOffset);
          const composingText = textContent.substring(startOffset, endOffset);
          const afterText = textContent.substring(endOffset);

          // Create the highlighted span
          const span = document.createElement("span");
          span.style.borderBottom = "2px dashed #007bff";
          // span.style.backgroundColor = "rgba(0, 123, 255, 0.1)";
          span.textContent = composingText;

          // Replace the text node with structured content
          const beforeNode = document.createTextNode(beforeText);
          const afterNode = document.createTextNode(afterText);

          parent.replaceChild(afterNode, textNode);
          parent.insertBefore(span, afterNode);
          parent.insertBefore(beforeNode, span);
        }
      } else if (parent && !textNode) {
        // No text node yet - the element is empty or just being typed into
        // Create the highlighted span directly
        const span = document.createElement("span");
        span.style.borderBottom = "2px dashed #007bff";
        // span.style.backgroundColor = "rgba(0, 123, 255, 0.1)";
        span.textContent = compositionText;
        parent.appendChild(span);
      }
    }
  }

  function clearEditor() {
    editor.innerHTML = "";
    updateOutput();
  }

  function insertBold() {
    document.execCommand("bold");
  }

  function insertItalic() {
    document.execCommand("italic");
  }

  function insertMarkedParagraph() {
    // Create a new paragraph element with ID
    const p = document.createElement("p");
    p.id = "marked-text";
    p.textContent = "Testing dynamic content styling with ID";

    // Get the current selection
    const selection = window.getSelection();
    if (selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);

      // Delete any selected content
      range.deleteContents();

      // Insert the new paragraph at the caret position
      range.insertNode(p);

      // Move the caret after the inserted paragraph
      range.setStartAfter(p);
      range.setEndAfter(p);
      selection.removeAllRanges();
      selection.addRange(range);
    } else {
      // Fallback: append to editor if no selection
      editor.appendChild(p);
    }

    // Focus back on the editor
    editor.focus();
  }

  function toggleMergeMode() {
    const container = document.querySelector(".container");
    const checkbox = document.getElementById("mergeCheckbox");
    const editorSections = document.querySelectorAll(".editor-section h3");

    if (checkbox.checked) {
      // Enable merge mode
      container.classList.add("merged");
      // Hide section headers in merged mode
      editorSections.forEach((h3) => (h3.style.display = "none"));
    } else {
      // Disable merge mode
      container.classList.remove("merged");
      // Show section headers
      editorSections.forEach((h3) => (h3.style.display = "block"));
    }
  }

  // Auto sync content on page load
  updateOutput();

  // Make functions globally accessible
  window.clearEditor = clearEditor;
  window.insertBold = insertBold;
  window.insertItalic = insertItalic;
  window.insertMarkedParagraph = insertMarkedParagraph;
  window.toggleMergeMode = toggleMergeMode;
});
