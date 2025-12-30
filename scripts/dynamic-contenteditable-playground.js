// Import shared helper functions
import {
  copyComputedStyles,
  copyAllVisualStyles,
  calculateAdjustedDimensions,
  getNodePath,
  getNodeByPath,
  findNearestAncestor,
  applyCustomCSS
} from "./utils.js";

document.addEventListener("DOMContentLoaded", function () {
  // State variables
  let primaryEditor = null;
  let cloneEditor = null;
  let isComposing = false;
  let compositionStartOffset = 0;
  let compositionStartPath = null;
  let compositionData = "";
  let rafId = null;
  let range = null;
  let positionedAncestor = null;
  let resizeObserver = null;
  let observer = null;
  let useAutoHeight = false;

  const observerConfig = {
    childList: true,
    subtree: true,
    attributes: true,
    characterData: true
  };

  function handleCompositionStart() {
    isComposing = true;
    const selection = window.getSelection();
    if (selection.rangeCount > 0) {
      range = selection.getRangeAt(0);
      compositionStartOffset = range.startOffset;
      compositionStartPath = getNodePath(range.startContainer, primaryEditor);
    }
    console.log("Composition started at offset:", compositionStartOffset);
  }

  function handleCompositionUpdate(e) {
    if (isComposing) {
      compositionData = e.data || "";
      console.log("Composition update:", compositionData);
    }
  }

  function handleCompositionEnd(e) {
    isComposing = false;
    compositionData = "";
    compositionStartPath = null;
    console.log("Composition ended:", e.data);
    updateClone();
  }

  function handleScroll() {
    if (cloneEditor) {
      cloneEditor.scrollTop = primaryEditor.scrollTop;
      cloneEditor.scrollLeft = primaryEditor.scrollLeft;
    }
  }

  document.addEventListener(
    "focus",
    (event) => {
      const isEditable = event.target.isContentEditable;
      console.log("Focus:", event.target, "contenteditable:", isEditable);
      if (isEditable) {
        if (primaryEditor && primaryEditor !== event.target) {
          // Remove event handlers
          primaryEditor.removeEventListener(
            "compositionstart",
            handleCompositionStart
          );

          primaryEditor.removeEventListener(
            "compositionupdate",
            handleCompositionUpdate
          );

          primaryEditor.removeEventListener(
            "compositionend",
            handleCompositionEnd
          );

          primaryEditor.removeEventListener("scroll", handleScroll);

          // Disconnect MutationObserver
          if (observer) {
            observer.disconnect();
            observer = null;
          }
        }

        primaryEditor = event.target;

        // Composition event handlers
        primaryEditor.addEventListener(
          "compositionstart",
          handleCompositionStart
        );

        primaryEditor.addEventListener(
          "compositionupdate",
          handleCompositionUpdate
        );

        primaryEditor.addEventListener("compositionend", handleCompositionEnd);

        // Focus event - create clone
        const primaryStyles = window.getComputedStyle(primaryEditor);
        createCloneEditor(primaryStyles);

        // Scroll sync
        primaryEditor.addEventListener("scroll", handleScroll);

        // MutationObserver with RAF throttling
        observer = new MutationObserver(function (mutations) {
          if (rafId) {
            cancelAnimationFrame(rafId);
          }

          const relevantMutations = mutations.filter((mutation) => {
            // Ignore data-overlay-mode attribute changes
            return !(
              mutation.type === "attributes" &&
              mutation.attributeName === "data-overlay-mode"
            );
          });

          if (relevantMutations.length === 0) return;

          rafId = requestAnimationFrame(() => {
            if (isComposing) {
              console.log(
                "DOM changed during composition, highlighting:",
                compositionData
              );
            }
            updateClone(compositionData);
            handleScroll();
            rafId = null;
          });
        });

        observer.observe(primaryEditor, observerConfig);
      }
    },
    true
  );

  document.addEventListener(
    "blur",
    (event) => {
      const isEditable = event.target.isContentEditable;
      console.log("Blur:", event.target, "contenteditable:", isEditable);
      if (isEditable && event.target === primaryEditor) {
        // Blur event - remove clone
        //removeCloneEditor();
      }
    },
    true
  );

  // Create clone on focus (ensures element is fully rendered)
  function createCloneEditor(computed) {
    if (cloneEditor) return; // Already created

    // 1. Capture measurements BEFORE changing anything
    const primaryRect = primaryEditor.getBoundingClientRect();
    const originalBgColor = computed.backgroundColor;
    const originalWidth = computed.width;
    const originalHeight = computed.height;

    // Auto height when: (min-height set AND no overflow constraint) OR max-height set
    const hasMinHeight = computed.minHeight !== "none";
    const hasMaxHeight = computed.maxHeight !== "none";
    const hasOverflowConstraint =
      computed.overflow !== "visible" && computed.overflow !== "";
    useAutoHeight = hasMaxHeight || (hasMinHeight && !hasOverflowConstraint);

    // 2. Find parent container
    const parent = findNearestAncestor(primaryEditor);
    const parentRect = parent.getBoundingClientRect();
    // This ratio helps maintain size relative to parent on resize(border-box)
    let widthRatio = primaryRect.width / parentRect.width;
    let heightRatio = primaryRect.height / parentRect.height;

    // 3. Calculate offset from parent
    // Account for parent's border since absolute positioning is relative to padding edge
    const parentComputed = window.getComputedStyle(parent);
    const parentBorderTop = parseFloat(parentComputed.borderTopWidth) || 0;
    const parentBorderLeft = parseFloat(parentComputed.borderLeftWidth) || 0;

    const topOffset = primaryRect.top - parentRect.top - parentBorderTop;
    const leftOffset = primaryRect.left - parentRect.left - parentBorderLeft;

    // 4. Make parent positioned if needed
    if (parentComputed.position === "static") {
      parent.style.position = "relative";
      positionedAncestor = parent;
      console.log("Made parent positioned (relative)");
    }

    // 5. Set up editor positioning
    // Primary: position relative (stays in document flow, maintains parent height)
    // Clone: position absolute (overlays primary, positioned via top/left offsets)
    applyCustomCSS(primaryEditor, {
      position: "relative"
    });

    // 6. Create and position clone
    cloneEditor = primaryEditor.cloneNode(true);
    cloneEditor.id = "clone-editor";
    cloneEditor.contentEditable = "false"; // Display-only

    // Position clone to overlay primary exactly
    applyCustomCSS(cloneEditor, {
      position: "absolute",
      top: topOffset,
      left: leftOffset,
      width: originalWidth,
      height: originalHeight,
      margin: "0"
    });

    // Copy all visual computed styles
    copyAllVisualStyles(primaryEditor, cloneEditor);

    // Transparency setup
    cloneEditor.style.backgroundColor = originalBgColor;
    cloneEditor.style.color = originalBgColor; // Hide text
    primaryEditor.setAttribute("data-overlay-mode", "true");

    // Insert clone before primary (ensures primary renders on top via DOM order)
    parent.insertBefore(cloneEditor, primaryEditor);

    // 7. Set up ResizeObserver to handle parent container resize
    resizeObserver = new ResizeObserver((entries) => {
      for (let entry of entries) {
        let parentDimensions = { width: 0, height: 0 };

        if (entry.borderBoxSize?.length > 0) {
          parentDimensions = {
            width: entry.borderBoxSize[0].inlineSize,
            height: entry.borderBoxSize[0].blockSize
          };
        } else {
          const parentRect = parent.getBoundingClientRect();
          parentDimensions = {
            width: parentRect.width,
            height: parentRect.height
          };
        }

        const newWidth = parseInt(parentDimensions.width * widthRatio);
        const newHeight = parseInt(parentDimensions.height * heightRatio);

        const adjustedDimensions = calculateAdjustedDimensions(
          computed,
          newWidth,
          newHeight
        );

        // Update clone dimensions to match resized primary
        if (cloneEditor) {
          cloneEditor.style.width = adjustedDimensions.width + "px";
          cloneEditor.style.height = useAutoHeight
            ? "auto"
            : adjustedDimensions.height + "px";
        }
      }
    });

    resizeObserver.observe(parent);

    // 8. Initial content sync
    updateClone();
  }

  // Remove clone on blur
  function removeCloneEditor() {
    if (!cloneEditor) return;

    // 1. Disconnect observers
    if (observer) {
      observer.disconnect();
      observer = null;
      console.log("MutationObserver disconnected");
    }

    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
      console.log("ResizeObserver disconnected");
    }

    // 2. Remove clone
    cloneEditor.remove();
    cloneEditor = null;
    console.log("Clone removed");

    // 3. Restore primary editor's position
    primaryEditor.style.position = "";
    primaryEditor.removeAttribute("data-overlay-mode");

    // 4. Clear parent reference (leave parent positioned for stability)
    if (positionedAncestor) {
      positionedAncestor = null;
    }

    // 5. Reset flags
    useAutoHeight = false;

    console.log("Clone editor removed and state restored");
  }

  // Update clone content with optional composition highlighting
  function updateClone(compositionText = null) {
    if (!cloneEditor) return;

    // Remove overlay-mode temporarily
    primaryEditor.removeAttribute("data-overlay-mode");

    // Sync root element attributes from primary to clone (except id and specific attributes)
    // Clear existing classes and data attributes on clone
    cloneEditor.className = primaryEditor.className;

    // Copy other attributes (except id, contenteditable, style, and data-overlay-mode)
    Array.from(primaryEditor.attributes).forEach((attr) => {
      if (
        !["id", "contenteditable", "style", "data-overlay-mode"].includes(
          attr.name
        )
      ) {
        cloneEditor.setAttribute(attr.name, attr.value);
      }
    });

    // Create a range covering just the contents of src
    const range = document.createRange();
    range.selectNodeContents(primaryEditor);

    // Clone the primary editor's content
    const clonedContent = range.cloneContents();

    // Merged operation: Copy backgrounds for ALL elements + extra styles for IDs
    const primaryElements = primaryEditor.querySelectorAll("*");
    const clonedElements = clonedContent.querySelectorAll("*");

    primaryElements.forEach((primaryEl, index) => {
      const clonedEl = clonedElements[index];
      if (!clonedEl) return;

      // 1. If element has ID, copy additional computed styles
      if (clonedEl.hasAttribute("id")) {
        copyComputedStyles(primaryEl, clonedEl);
        clonedEl.removeAttribute("id"); // Strip ID after copying
      }

      // 2. Copy background and color for ALL elements
      const computed = window.getComputedStyle(primaryEl);
      clonedEl.style.backgroundColor = computed.backgroundColor;
      clonedEl.style.color = computed.backgroundColor; // Hide text
    });

    // Apply composition highlighting if active
    if (isComposing && compositionText && compositionStartPath) {
      applyCompositionHighlight(compositionText, clonedContent);
    }

    primaryEditor.setAttribute("data-overlay-mode", "true");

    cloneEditor.replaceChildren(clonedContent);
  }

  // Apply composition highlighting to cloned content
  function applyCompositionHighlight(compositionText, clonedContent) {
    const targetNode = getNodeByPath(compositionStartPath, clonedContent);

    if (targetNode && compositionText) {
      let textNode = targetNode;
      let parent = null;

      // Handle document fragment, element node, or text node
      if (
        targetNode.nodeType === Node.DOCUMENT_FRAGMENT_NODE ||
        targetNode.nodeType === Node.ELEMENT_NODE
      ) {
        // DocumentFragment or Element - look for text nodes in children
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
