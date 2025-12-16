// Import shared helper functions
import {
  copyComputedStyles,
  calculateAdjustedDimensions,
  getNodePath,
  getNodeByPath,
  onlyToggledSpecialClass,
  findNearestAncestor,
  applyCustomCSS,
  isHeightChanging
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
  let originalPrimaryPosition = null;
  let spacerElement = null;
  let resizeObserver = null;
  let observer = null;
  let shouldRecalculateHeightRatio = false;

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
        createCloneEditor();

        // Scroll sync
        primaryEditor.addEventListener("scroll", handleScroll);

        // MutationObserver with RAF throttling
        observer = new MutationObserver(function (records) {
          if (rafId) {
            cancelAnimationFrame(rafId);
          }

          const validMutations = records.filter((r) => {
            if (r.type === "attributes" && r.attributeName === "class") {
              const el = r.target;

              const oldClass = r.oldValue ?? "";
              const newClass = el.getAttribute("class") ?? "";

              // If the only class delta is overlay-mode, ignore
              if (onlyToggledSpecialClass(oldClass, newClass, "overlay-mode")) {
                return false;
              }
            }
            return true;
          });

          if (validMutations.length === 0) return;

          rafId = requestAnimationFrame(() => {
            if (isComposing) {
              console.log(
                "DOM changed during composition, highlighting:",
                compositionData
              );
            }
            updateClone(compositionData);
            handleScroll();

            const shouldUpdateEditorheight =
              isHeightChanging(primaryEditor) &&
              !["scroll", "auto"].includes(
                window.getComputedStyle(primaryEditor).overflowY
              );

            if (shouldUpdateEditorheight) {
              updateEditorHeight();
            }

            rafId = null;
          });
        });

        observer.observe(primaryEditor, {
          childList: true,
          subtree: true,
          attributes: true,
          characterData: true
        });
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
        removeCloneEditor();
      }
    },
    true
  );

  function updateEditorHeight() {
    if (!cloneEditor || !spacerElement) return;
    const scrollHeight = primaryEditor.scrollHeight;
    // Update spacer
    spacerElement.style.height = scrollHeight + "px";
    shouldRecalculateHeightRatio = true;
  }

  // Create clone on focus (ensures element is fully rendered)
  function createCloneEditor() {
    if (cloneEditor) return; // Already created

    // 1. Capture measurements BEFORE changing anything
    const primaryRect = primaryEditor.getBoundingClientRect();
    const computed = window.getComputedStyle(primaryEditor);
    const originalBgColor = computed.backgroundColor;
    const originalWidth = computed.width;
    const originalHeight = computed.height;
    const currentPosition = computed.position;

    // 2. Find parent container
    const parent = findNearestAncestor(primaryEditor);
    const parentRect = parent.getBoundingClientRect();
    // This ratio helps maintain size relative to parent on resize(border-box)
    let widthRatio = primaryRect.width / parentRect.width;
    let heightRatio = primaryRect.height / parentRect.height;

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
    applyCustomCSS(primaryEditor, {
      position: "absolute",
      top: topOffset,
      left: leftOffset,
      width: originalWidth,
      height: originalHeight,
      zIndex: "2" // On top
    });

    // 8. Create and position clone
    cloneEditor = primaryEditor.cloneNode(true);
    cloneEditor.id = "clone-editor";
    cloneEditor.contentEditable = "false"; // Display-only

    // Position clone identically to primary
    applyCustomCSS(cloneEditor, {
      position: "absolute",
      top: topOffset,
      left: leftOffset,
      width: originalWidth,
      height: originalHeight,
      zIndex: "1" // Below primary
    });

    // Copy all visual computed styles
    copyAllVisualStyles(primaryEditor, cloneEditor);

    // Transparency setup
    cloneEditor.style.backgroundColor = originalBgColor;
    cloneEditor.style.color = originalBgColor; // Hide text
    primaryEditor.classList.add("overlay-mode"); // Instead of inline style

    // Insert clone before primary
    parent.insertBefore(cloneEditor, primaryEditor);

    // 9. Set up ResizeObserver to handle parent container resize
    resizeObserver = new ResizeObserver((entries) => {
      for (let _ of entries) {
        const parentRect = parent.getBoundingClientRect();

        if (shouldRecalculateHeightRatio) {
          const spaceRect = spacerElement.getBoundingClientRect();
          heightRatio = spaceRect.height / parentRect.height;
        }

        const newWidth = parseInt(parentRect.width * widthRatio);
        const newHeight = parseInt(parentRect.height * heightRatio);

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
    primaryEditor.classList.remove("overlay-mode"); // Instead of inline style
    primaryEditor.style.zIndex = "";

    // 6. Restore parent's position if we changed it
    if (positionedAncestor) {
      // Note: We leave parent as positioned since other content might depend on it
      // Only clear our reference
      positionedAncestor = null;
    }

    shouldRecalculateHeightRatio = false;

    console.log("Clone editor removed and state restored");
  }

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
      //"lineHeight",
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

    // Remove overlay-mode temporarily
    primaryEditor.classList.remove("overlay-mode");

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

    primaryEditor.classList.add("overlay-mode");

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

  //NOTE: This code can be removed later
  //const parentComputed = window.getComputedStyle(parent);
  // Calculate adjusted parent dimensions (border-box)
  // const adjustedParentDimensions = calculateAdjustedDimensions(
  //   parentComputed,
  //   entry.contentRect.width,
  //   entry.contentRect.height,
  //   false
  // );
});
