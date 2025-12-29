// Import shared helper functions
import {
  copyComputedStyles,
  copyAllVisualStyles,
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
  let hasMaxHeight = false;
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

            // Break down the height update conditions for clarity
            const isEditorHeightChanging = isHeightChanging(primaryEditor);
            const hasNoScrollOverflow = !["scroll", "auto"].includes(
              primaryStyles.overflowY
            );
            const isBelowMaxHeight =
              primaryStyles.maxHeight !== "none" &&
              parseFloat(primaryStyles.height) <
                parseFloat(primaryStyles.maxHeight);

            const shouldUpdateEditorheight =
              isEditorHeightChanging &&
              (hasNoScrollOverflow || isBelowMaxHeight);

            if (shouldUpdateEditorheight) {
              updateEditorHeight(
                isEditorHeightChanging && hasNoScrollOverflow,
                primaryStyles
              );
            }

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
        removeCloneEditor();
      }
    },
    true
  );

  function updateEditorHeight(canGrowVertically = true, primaryStyles) {
    if (!cloneEditor || !spacerElement) return;
    let actualHeight = 0;
    // Use scrollHeight + border width when element can grow (no scroll overflow), otherwise use rendered height
    if (canGrowVertically) {
      const heightComponents = [
        primaryEditor.scrollHeight,
        primaryStyles.borderTopWidth,
        primaryStyles.borderBottomWidth
      ];
      actualHeight = heightComponents
        .map(parseFloat)
        .reduce((a, b) => a + b, 0);
    } else {
      actualHeight = primaryEditor.getBoundingClientRect().height;
    }
    // Update spacer to match calculated height
    spacerElement.style.height = actualHeight + "px";
    shouldRecalculateHeightRatio = true;
  }

  // Create clone on focus (ensures element is fully rendered)
  function createCloneEditor(computed) {
    if (cloneEditor) return; // Already created

    // 1. Capture measurements BEFORE changing anything
    const primaryRect = primaryEditor.getBoundingClientRect();
    const originalBgColor = computed.backgroundColor;
    const originalWidth = computed.width;
    const originalHeight = computed.height;
    const currentPosition = computed.position;

    // Track if max-height is set (not 'none')
    hasMaxHeight =
      computed.maxHeight !== "none" || computed.minHeight !== "none";

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
    spacerElement.style.display = "block";
    spacerElement.style.overflow = "hidden";

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

    let commonEditorCSSAttributes = {
      position: "absolute",
      top: topOffset,
      left: leftOffset,
      width: originalWidth,
      height: originalHeight,
      margin: "0"
    };

    // 7. Make primary absolutely positioned with calculated offset
    applyCustomCSS(primaryEditor, {
      ...commonEditorCSSAttributes,
      zIndex: "2" // On top
    });

    // 8. Create and position clone
    cloneEditor = primaryEditor.cloneNode(true);
    cloneEditor.id = "clone-editor";
    cloneEditor.contentEditable = "false"; // Display-only

    // Position clone identically to primary
    applyCustomCSS(cloneEditor, {
      ...commonEditorCSSAttributes,
      zIndex: "1" // Below primary
    });

    // Copy all visual computed styles
    copyAllVisualStyles(primaryEditor, cloneEditor);

    // Transparency setup
    cloneEditor.style.backgroundColor = originalBgColor;
    cloneEditor.style.color = originalBgColor; // Hide text
    primaryEditor.setAttribute("data-overlay-mode", "true");

    // Insert clone before primary
    parent.insertBefore(cloneEditor, primaryEditor);

    // 9. Set up ResizeObserver to handle parent container resize
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

        if (shouldRecalculateHeightRatio) {
          const spaceRect = spacerElement.getBoundingClientRect();
          heightRatio = spaceRect.height / parentDimensions.height;
        }

        const newWidth = parseInt(parentDimensions.width * widthRatio);
        const newHeight = parseInt(parentDimensions.height * heightRatio);

        spacerElement.style.width = newWidth + "px";
        spacerElement.style.height = newHeight + "px";

        const adjustedDimensions = calculateAdjustedDimensions(
          computed,
          newWidth,
          newHeight
        );

        // Update primary
        primaryEditor.style.width = adjustedDimensions.width + "px";

        if (hasMaxHeight) {
          // Don't set explicit height - let content determine it (up to max-height)
          primaryEditor.style.height = "auto";
        } else {
          // No max-height, set explicit height
          primaryEditor.style.height = adjustedDimensions.height + "px";
        }

        // Update clone
        if (cloneEditor) {
          cloneEditor.style.width = adjustedDimensions.width + "px";

          if (hasMaxHeight) {
            cloneEditor.style.height = "auto";
          } else {
            cloneEditor.style.height = adjustedDimensions.height + "px";
          }
        }
      }
    });

    resizeObserver.observe(parent);

    // 10. Initial content sync
    updateClone();
  }

  // Remove clone on blur
  function removeCloneEditor() {
    if (!cloneEditor) return;

    if (observer) {
      observer.disconnect();
      observer = null;
      console.log("MutationObserver disconnected");
    }

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
      primaryEditor.style.margin = ""; // Restore original margin
      originalPrimaryPosition = null;
      console.log("Primary position restored");
    }

    // 5. Restore primary editor's background and z-index
    primaryEditor.removeAttribute("data-overlay-mode");
    primaryEditor.style.zIndex = "";

    // 6. Restore parent's position if we changed it
    if (positionedAncestor) {
      // Note: We leave parent as positioned since other content might depend on it
      // Only clear our reference
      positionedAncestor = null;
    }

    // 7. Reset height-related flags
    shouldRecalculateHeightRatio = false;
    hasMaxHeight = false;

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
    Array.from(primaryEditor.attributes).forEach(attr => {
      if (!['id', 'contenteditable', 'style', 'data-overlay-mode'].includes(attr.name)) {
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
