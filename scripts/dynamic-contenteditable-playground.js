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
  let spacerElement = null;
  let resizeObserver = null;
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

  // Calculate adjusted dimensions based on box-sizing model
  function calculateAdjustedDimensions(computed, width, height) {
    const boxSizing = computed.boxSizing;
    let adjustedWidth = width;
    let adjustedHeight = height;

    if (boxSizing === "content-box") {
      const paddingLeft = parseFloat(computed.paddingLeft) || 0;
      const paddingRight = parseFloat(computed.paddingRight) || 0;
      const borderLeft = parseFloat(computed.borderLeftWidth) || 0;
      const borderRight = parseFloat(computed.borderRightWidth) || 0;
      adjustedWidth =
        width - paddingLeft - paddingRight - borderLeft - borderRight;

      const paddingTop = parseFloat(computed.paddingTop) || 0;
      const paddingBottom = parseFloat(computed.paddingBottom) || 0;
      const borderTop = parseFloat(computed.borderTopWidth) || 0;
      const borderBottom = parseFloat(computed.borderBottomWidth) || 0;
      adjustedHeight =
        height - paddingTop - paddingBottom - borderTop - borderBottom;
    }

    return { width: adjustedWidth, height: adjustedHeight };
  }

  // Create clone on focus (ensures element is fully rendered)
  function createCloneEditor() {
    if (cloneEditor) return; // Already created

    // 1. Capture measurements BEFORE changing anything
    const primaryRect = primaryEditor.getBoundingClientRect();
    const computed = window.getComputedStyle(primaryEditor);
    const originalBgColor = computed.backgroundColor;
    const currentPosition = computed.position;

    // Calculate dimensions adjusted for box-sizing
    const adjustedDimensions = calculateAdjustedDimensions(
      computed,
      primaryRect.width,
      primaryRect.height
    );
    const originalWidth = adjustedDimensions.width;
    const originalHeight = adjustedDimensions.height;

    // 2. Find parent container
    const parent = findNearestAncestor(primaryEditor);
    const parentRect = parent.getBoundingClientRect();

    const widthRatio = primaryRect.width / parentRect.width;
    const heightRatio = primaryRect.height / parentRect.height;

    // 3. Calculate offset from parent
    const topOffset = primaryRect.top - parentRect.top;
    const leftOffset = primaryRect.left - parentRect.left;

    // 4. Create spacer to prevent parent collapse
    spacerElement = document.createElement("div");
    spacerElement.id = "primary-editor-spacer";
    spacerElement.style.width = primaryRect.width + "px";
    spacerElement.style.height = primaryRect.height + "px";
    spacerElement.style.visibility = "hidden"; // Invisible but takes space
    spacerElement.style.pointerEvents = "none";

    // Insert spacer before primary
    parent.insertBefore(spacerElement, primaryEditor);

    // 5. Make parent positioned if needed
    const parentComputed = window.getComputedStyle(parent);
    if (parentComputed.position === "static") {
      parent.style.position = "relative";
      positionedAncestor = parent;
      console.log("Made parent positioned (relative)");
    }

    // 6. Store original position for restoration
    originalPrimaryPosition = currentPosition;

    // 7. Make primary absolutely positioned with calculated offset
    primaryEditor.style.position = "absolute";
    primaryEditor.style.top = topOffset + "px";
    primaryEditor.style.left = leftOffset + "px";
    primaryEditor.style.width = originalWidth + "px";
    primaryEditor.style.height = originalHeight + "px";
    primaryEditor.style.zIndex = "2"; // On top
    primaryEditor.style.backgroundColor = "transparent";

    // 8. Create and position clone
    cloneEditor = primaryEditor.cloneNode(true);
    cloneEditor.id = "clone-editor";
    cloneEditor.contentEditable = "false"; // Display-only

    // Copy all visual computed styles
    copyAllVisualStyles(primaryEditor, cloneEditor);

    // Position clone identically to primary
    cloneEditor.style.position = "absolute";
    cloneEditor.style.top = topOffset + "px";
    cloneEditor.style.left = leftOffset + "px";
    cloneEditor.style.width = originalWidth + "px";
    cloneEditor.style.height = originalHeight + "px";
    cloneEditor.style.zIndex = "1"; // Below primary

    // Transparency setup
    cloneEditor.style.backgroundColor = originalBgColor;
    cloneEditor.style.color = originalBgColor; // Hide text

    // Insert clone before primary
    parent.insertBefore(cloneEditor, primaryEditor);

    // 9. Set up ResizeObserver to handle resize
    resizeObserver = new ResizeObserver((entries) => {
      for (let entry of entries) {
        const newWidth = parseInt(entry.contentRect.width * widthRatio);
        const newHeight = parseInt(entry.contentRect.height * heightRatio);

        spacerElement.style.width = newWidth + "px";
        spacerElement.style.height = newHeight + "px";

        const adjustedDimensions = calculateAdjustedDimensions(
          computed,
          newWidth,
          newHeight
        );

        // Update primary
        primaryEditor.style.width = adjustedDimensions.width + "px";
        primaryEditor.style.height = adjustedDimensions.height + "px";

        // Update clone
        if (cloneEditor) {
          cloneEditor.style.width = adjustedDimensions.width + "px";
          cloneEditor.style.height = adjustedDimensions.height + "px";
        }
      }
    });

    resizeObserver.observe(parent);

    // 10. Initial content sync
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

    console.log("Removing clone editor and restoring state");

    // 1. Disconnect ResizeObserver
    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
      console.log("ResizeObserver disconnected");
    }

    // 2. Remove spacer element
    if (spacerElement) {
      spacerElement.remove();
      spacerElement = null;
      console.log("Spacer removed");
    }

    // 3. Remove clone
    cloneEditor.remove();
    cloneEditor = null;
    console.log("Clone removed");

    // 4. Restore primary editor's original position
    if (originalPrimaryPosition !== null) {
      primaryEditor.style.position = originalPrimaryPosition;
      primaryEditor.style.top = "";
      primaryEditor.style.left = "";
      primaryEditor.style.width = "";
      primaryEditor.style.height = "";
      originalPrimaryPosition = null;
      console.log("Primary position restored");
    }

    // 5. Restore primary editor's background and z-index
    primaryEditor.style.backgroundColor = "";
    primaryEditor.style.zIndex = "";

    // 6. Restore parent's position if we changed it
    if (positionedAncestor) {
      // Note: We leave parent as positioned since other content might depend on it
      // Only clear our reference
      positionedAncestor = null;
    }

    console.log("Clone editor removed and state restored");
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
      "overflowX",
      "border"
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

    // Create a range covering just the contents of src
    const range = document.createRange();
    range.selectNodeContents(primaryEditor);

    // Clone the primary editor's content
    const clonedContent = range.cloneContents();

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

    cloneEditor.replaceChildren(clonedContent);
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
    p.innerHTML = `Testing dynamic content styling with ID.`;

    const selection = window.getSelection();
    if (selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      range.deleteContents();
      range.insertNode(p);
      range.setStartAfter(p);
      range.setEndAfter(p);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
    } else {
      primaryEditor.appendChild(p);
    }

    primaryEditor.focus();
  }

  // Make functions globally accessible
  window.clearEditor = clearEditor;
  window.insertMarkedParagraph = insertMarkedParagraph;
});
