// Import shared helper functions
import { copyComputedStyles, getNodePath, getNodeByPath } from "./utils.js";

document.addEventListener("DOMContentLoaded", function () {
  // State variables
  let cloneEditor = null;
  let isComposing = false;
  let compositionStartOffset = 0;
  let compositionStartPath = null;
  let compositionData = "";
  let rafId = null;
  let range = null;
  let positionedAncestor = null;
  let originalPrimaryPosition = null;
  const primaryEditor = document.getElementById("primary-editor");

  // Composition event handlers
  primaryEditor.addEventListener("compositionstart", function (e) {
    isComposing = true;
    const selection = window.getSelection();
    if (selection.rangeCount > 0) {
      range = selection.getRangeAt(0);
      compositionStartOffset = range.startOffset;
      compositionStartPath = getNodePath(range.startContainer, primaryEditor);
    }
    console.log("Composition started at offset:", compositionStartOffset);
  });

  primaryEditor.addEventListener("compositionupdate", function (e) {
    if (isComposing) {
      compositionData = e.data || "";
      console.log("Composition update:", compositionData);
    }
  });

  primaryEditor.addEventListener("compositionend", function (e) {
    isComposing = false;
    compositionData = "";
    compositionStartPath = null;
    console.log("Composition ended:", e.data);
    updateClone();
  });

  // Focus event - create clone
  primaryEditor.addEventListener("focus", function () {
    console.log("Primary editor focused");
    createCloneEditor();
  });

  // Blur event - remove clone
  primaryEditor.addEventListener("blur", function () {
    console.log("Primary editor blurred");
    // Small delay to allow for potential re-focus
    setTimeout(() => {
      if (document.activeElement !== primaryEditor) {
        removeCloneEditor();
      }
    }, 100);
  });

  // Scroll sync
  primaryEditor.addEventListener("scroll", function () {
    if (cloneEditor) {
      cloneEditor.scrollTop = primaryEditor.scrollTop;
      cloneEditor.scrollLeft = primaryEditor.scrollLeft;
    }
  });

  // MutationObserver with RAF throttling
  const observer = new MutationObserver(function (mutations) {
    if (rafId) {
      cancelAnimationFrame(rafId);
    }

    rafId = requestAnimationFrame(() => {
      if (isComposing) {
        console.log(
          "DOM changed during composition, highlighting:",
          compositionData
        );
      }
      updateClone(compositionData);
      rafId = null;
    });
  });

  observer.observe(primaryEditor, {
    childList: true,
    subtree: true,
    attributes: true,
    characterData: true
  });

  // Create clone on focus (ensures element is fully rendered)
  function createCloneEditor() {
    if (cloneEditor) return; // Already created

    // Check if primary editor is already absolutely positioned
    const computed = window.getComputedStyle(primaryEditor);
    const currentPosition = computed.position;
    const originalBgColor = computed.backgroundColor;

    console.log("Primary editor position:", currentPosition);

    if (currentPosition !== "absolute") {
      // Need to make primary absolute
      // First, find and position the nearest ancestor
      positionedAncestor = findNearestAncestor(primaryEditor);

      if (positionedAncestor) {
        // Make ancestor positioned (relative) if not already
        const ancestorComputed = window.getComputedStyle(positionedAncestor);
        if (ancestorComputed.position === "static") {
          positionedAncestor.style.position = "relative";
          console.log(
            "Made ancestor positioned (relative):",
            positionedAncestor
          );
        }
      }

      // Store original position for restoration on blur
      originalPrimaryPosition = currentPosition;

      // Make primary absolutely positioned
      primaryEditor.style.position = "absolute";
      primaryEditor.style.top = "0";
      primaryEditor.style.left = "0";
      primaryEditor.style.width = computed.width;
      primaryEditor.style.height = computed.height;
      console.log("Made primary absolutely positioned");
    }

    // Clone the primary editor
    cloneEditor = primaryEditor.cloneNode(true);
    cloneEditor.id = "clone-editor";
    cloneEditor.contentEditable = "false"; // Display-only

    // Copy all visual computed styles
    copyAllVisualStyles(primaryEditor, cloneEditor);

    // Position clone absolutely below primary
    cloneEditor.style.position = "absolute";
    cloneEditor.style.top = "0";
    cloneEditor.style.left = "0";
    cloneEditor.style.zIndex = "1"; // Below primary

    // Set clone's background to the original background color
    cloneEditor.style.backgroundColor = originalBgColor;

    // Hide clone's text by setting text color same as background
    cloneEditor.style.color = originalBgColor;

    // Make primary editor background transparent (so we can see through to clone)
    primaryEditor.style.backgroundColor = "transparent";
    primaryEditor.style.zIndex = "2"; // On top

    // Insert clone before primary in the container
    const parent = primaryEditor.parentNode;
    parent.insertBefore(cloneEditor, primaryEditor);

    // // Set up scroll sync for clone
    // cloneEditor.addEventListener("scroll", handleCloneScroll);

    // Initial sync
    updateClone();

    console.log("Clone editor created with transparent overlay effect");
    console.log("Original background color:", originalBgColor);
  }

  // Find nearest block-level ancestor that can serve as positioning context
  function findNearestAncestor(element) {
    let parent = element.parentNode;

    // Traverse up until we find a suitable container
    while (parent && parent !== document.body) {
      const computed = window.getComputedStyle(parent);
      const display = computed.display;

      // Look for block-level elements (div, section, main, etc.)
      if (display === "block" || display === "flex" || display === "grid") {
        return parent;
      }

      parent = parent.parentNode;
    }

    // Fallback to direct parent if no block-level ancestor found
    return element.parentNode;
  }

  // Remove clone on blur
  function removeCloneEditor() {
    if (!cloneEditor) return;

    // Remove clone from DOM
    // cloneEditor.removeEventListener("scroll", handleCloneScroll);
    cloneEditor.remove();
    cloneEditor = null;

    // Restore primary editor's original position if we changed it
    if (originalPrimaryPosition !== null) {
      primaryEditor.style.position = originalPrimaryPosition;
      primaryEditor.style.top = "";
      primaryEditor.style.left = "";
      primaryEditor.style.width = "";
      primaryEditor.style.height = "";
      originalPrimaryPosition = null;
    }

    // Restore primary editor's background
    primaryEditor.style.backgroundColor = "";
    primaryEditor.style.zIndex = "";

    console.log("Clone editor removed");
  }

  // Scroll handler for clone
  // function handleCloneScroll() {
  //   if (cloneEditor) {
  //     primaryEditor.scrollTop = cloneEditor.scrollTop;
  //     primaryEditor.scrollLeft = cloneEditor.scrollLeft;
  //   }
  // }

  // Copy all visual computed styles from source to target
  function copyAllVisualStyles(source, target) {
    const computed = window.getComputedStyle(source);

    // Copy all important visual properties
    const visualProps = [
      "width",
      "height",
      "padding",
      "margin",
      "fontSize",
      "fontFamily",
      "fontWeight",
      "fontStyle",
      "lineHeight",
      "letterSpacing",
      "wordSpacing",
      "textAlign",
      "textDecoration",
      "textTransform",
      "borderRadius",
      "boxSizing",
      "overflowY",
      "overflowX"
    ];

    visualProps.forEach((prop) => {
      const value = computed[prop];
      if (value && value !== "initial" && value !== "inherit") {
        target.style[prop] = value;
      }
    });
  }

  // Update clone content with optional composition highlighting
  function updateClone(compositionText = null) {
    if (!cloneEditor) return;

    // Clone the primary editor's content
    const clonedContent = primaryEditor.cloneNode(true);

    // Copy computed styles for elements with IDs (before stripping)
    clonedContent.querySelectorAll("[id]").forEach((clonedEl) => {
      const sourceEl = primaryEditor.querySelector(
        "#" + CSS.escape(clonedEl.id)
      );
      if (sourceEl) {
        copyComputedStyles(sourceEl, clonedEl);
      }
      // Strip ID to avoid duplicates
      clonedEl.removeAttribute("id");
    });

    // Apply composition highlighting if active
    if (isComposing && compositionText && compositionStartPath) {
      applyCompositionHighlight(compositionText, clonedContent);
    }

    // Update clone's innerHTML
    cloneEditor.innerHTML = clonedContent.innerHTML;
  }

  // Apply composition highlighting to cloned content
  function applyCompositionHighlight(compositionText, clonedContent) {
    const targetNode = getNodeByPath(compositionStartPath, clonedContent);

    if (targetNode && compositionText) {
      let textNode = targetNode;
      let parent = null;

      // Handle element node vs text node
      if (targetNode.nodeType === Node.ELEMENT_NODE) {
        if (range && range.startOffset < targetNode.childNodes.length) {
          const childNode = targetNode.childNodes[range.startOffset];
          if (childNode && childNode.nodeType === Node.TEXT_NODE) {
            textNode = childNode;
            parent = targetNode;
          }
        } else if (targetNode.childNodes.length > 0) {
          const lastChild =
            targetNode.childNodes[targetNode.childNodes.length - 1];
          if (lastChild && lastChild.nodeType === Node.TEXT_NODE) {
            textNode = lastChild;
            parent = targetNode;
          }
        } else {
          textNode = null;
          parent = targetNode;
        }
      } else if (targetNode.nodeType === Node.TEXT_NODE) {
        textNode = targetNode;
        parent = targetNode.parentNode;
      }

      // Apply highlighting
      if (textNode && textNode.nodeType === Node.TEXT_NODE && parent) {
        const textContent = textNode.textContent;
        const compositionLength = compositionText.length;
        const startOffset = compositionStartOffset;
        const endOffset = startOffset + compositionLength;

        if (startOffset >= 0 && endOffset <= textContent.length) {
          const beforeText = textContent.substring(0, startOffset);
          const composingText = textContent.substring(startOffset, endOffset);
          const afterText = textContent.substring(endOffset);

          // Create highlighted span
          const span = document.createElement("span");
          span.style.paddingBottom = "5px";
          span.style.borderBottom = "2px dashed #007bff";
          span.textContent = composingText;

          // Replace text node with structured content
          const beforeNode = document.createTextNode(beforeText);
          const afterNode = document.createTextNode(afterText);

          parent.replaceChild(afterNode, textNode);
          parent.insertBefore(span, afterNode);
          parent.insertBefore(beforeNode, span);
        }
      } else if (parent && !textNode) {
        // Empty element - create span directly
        const span = document.createElement("span");
        span.style.paddingBottom = "5px";
        span.style.borderBottom = "2px dashed #007bff";
        span.textContent = compositionText;
        parent.appendChild(span);
      }
    }
  }

  // Button functions
  function clearEditor() {
    primaryEditor.innerHTML = "";
    updateClone();
  }

  function insertMarkedParagraph() {
    const p = document.createElement("p");
    p.id = "marked-text";
    p.textContent = "Testing dynamic content styling with ID";

    const selection = window.getSelection();
    if (selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      range.deleteContents();
      range.insertNode(p);
      range.setStartAfter(p);
      range.setEndAfter(p);
      selection.removeAllRanges();
      selection.addRange(range);
    } else {
      primaryEditor.appendChild(p);
    }

    primaryEditor.focus();
  }

  // Initialize - no need to create clone on page load
  // Clone will be created on first focus

  // Make functions globally accessible
  window.clearEditor = clearEditor;
  window.insertMarkedParagraph = insertMarkedParagraph;
});
