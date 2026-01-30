// Import shared helper functions
import {
  copyComputedStyles,
  copyAllVisualStyles,
  calculateAdjustedDimensions,
  getNodePath,
  getNodeByPath,
  findNearestAncestor,
  applyCustomCSS,
  isTextInput as isTextInputElement
} from "./utils.js";

document.addEventListener("DOMContentLoaded", function () {
  // State variables
  let primaryElement = null;
  let cloneElement = null;
  let isComposing = false;
  let compositionStartOffset = 0;
  let compositionStartPath = null;
  let compositionData = "";
  let rafId = null;
  let range = null;
  let positionedAncestor = null;
  let resizeObserver = null;
  let observer = null;

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
      compositionStartPath = getNodePath(range.startContainer, primaryElement);
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
    if (cloneElement) {
      cloneElement.scrollTop = primaryElement.scrollTop;
      cloneElement.scrollLeft = primaryElement.scrollLeft;
    }
  }

  document.addEventListener(
    "focus",
    (event) => {
      const isEditable = event.target.isContentEditable;
      const isTextInput = isTextInputElement(event.target);
      console.log(
        "Focus:",
        event.target,
        "contenteditable:",
        isEditable,
        "isTextInput:",
        isTextInput
      );
      if (isEditable || isTextInput) {
        if (primaryElement && primaryElement !== event.target) {
          // Remove event handlers
          primaryElement.removeEventListener(
            "compositionstart",
            handleCompositionStart
          );

          primaryElement.removeEventListener(
            "compositionupdate",
            handleCompositionUpdate
          );

          primaryElement.removeEventListener(
            "compositionend",
            handleCompositionEnd
          );
        }

        primaryElement = event.target;

        // Composition event handlers
        primaryElement.addEventListener(
          "compositionstart",
          handleCompositionStart
        );

        primaryElement.addEventListener(
          "compositionupdate",
          handleCompositionUpdate
        );

        primaryElement.addEventListener("compositionend", handleCompositionEnd);

        // Focus event - create clone
        const primaryStyles = window.getComputedStyle(primaryElement);
        createCloneElement(primaryStyles, isTextInput);

        // Scroll sync
        primaryElement.addEventListener("scroll", handleScroll);

        if (isEditable) {
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

          observer.observe(primaryElement, observerConfig);
          updateClone();
        } else if (isTextInput) {
          // Text input - observe value changes
          primaryElement.addEventListener("input", (event) => {
            console.log("Text input value changed:", event.target.value);
          });
          cloneElement.textContent = primaryElement.value;
        }
      }
    },
    true
  );

  document.addEventListener(
    "blur",
    (event) => {
      const isEditable = event.target.isContentEditable;
      const isTextInput = isTextInputElement(event.target);
      console.log(
        "Blur:",
        event.target,
        "contenteditable:",
        isEditable,
        "isTextInput:",
        isTextInput
      );
      if ((isEditable || isTextInput) && event.target === primaryElement) {
        // Blur event - remove clone
        removeCloneElement();
      }
    },
    true
  );

  // Create clone on focus (ensures element is fully rendered)
  function createCloneElement(computed, isElementTextInput = false) {
    if (cloneElement) return; // Already created

    // 1. Capture measurements BEFORE changing anything
    const primaryRect = primaryElement.getBoundingClientRect();
    const originalBgColor = computed.backgroundColor;
    const originalWidth = computed.width;
    const originalHeight = computed.height;

    // 2. Find parent container
    const parent = findNearestAncestor(primaryElement);
    const parentRect = parent.getBoundingClientRect();

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
    // Only change primary to relative if it's currently static
    // This keeps it in document flow to maintain parent height
    const currentPosition = computed.position;
    if (currentPosition === "static") {
      applyCustomCSS(primaryElement, {
        position: "relative"
      });
    }

    // 6. Create and position clone
    cloneElement = isElementTextInput
      ? document.createElement("div")
      : primaryElement.cloneNode(true);
    cloneElement.id = "clone-editor";
    cloneElement.contentEditable = "false"; // Display-only

    // Position clone to overlay primary exactly
    applyCustomCSS(cloneElement, {
      position: "absolute",
      top: topOffset,
      left: leftOffset,
      width: originalWidth,
      height: originalHeight,
      margin: "0"
    });

    // Copy all visual computed styles
    copyAllVisualStyles(primaryElement, cloneElement);

    // Handle z-index stacking
    // If primary is absolute/fixed, both editors are positioned elements
    // DOM order alone won't guarantee stacking, so we need explicit z-index
    const finalPosition =
      currentPosition === "static" ? "relative" : currentPosition;
    const needsZIndex =
      finalPosition === "absolute" || finalPosition === "fixed";

    if (needsZIndex) {
      const originalZIndex = computed.zIndex;
      const baseZIndex =
        originalZIndex === "auto" ? 0 : parseInt(originalZIndex, 10);

      cloneElement.style.zIndex = baseZIndex - 1; // Clone below primary
      primaryElement.style.zIndex = baseZIndex; // Primary on top
      console.log(
        `Applied z-index: clone=${baseZIndex - 1}, primary=${baseZIndex}`
      );
    }

    // Transparency setup
    cloneElement.style.backgroundColor = originalBgColor;
    cloneElement.style.color = originalBgColor; // Hide text
    primaryElement.setAttribute("data-overlay-mode", "true");

    // Insert clone before primary (ensures primary renders on top via DOM order)
    parent.insertBefore(cloneElement, primaryElement);

    // Sync initial scroll position from primary to clone
    handleScroll();

    // 7. Set up ResizeObserver to watch primary editor
    // Fires when primary resizes for ANY reason:
    // - Parent container resize (window, devtools, etc.)
    // - Content changes (text wrapping, images loading)
    // - CSS changes (font-size, padding, max-height constraints)
    resizeObserver = new ResizeObserver((entries) => {
      for (let entry of entries) {
        let primaryDimensions = { width: 0, height: 0 };

        if (entry.borderBoxSize?.length > 0) {
          primaryDimensions = {
            width: entry.borderBoxSize[0].inlineSize,
            height: entry.borderBoxSize[0].blockSize
          };
        } else {
          const parentRect = parent.getBoundingClientRect();
          primaryDimensions = {
            width: parentRect.width,
            height: parentRect.height
          };
        }

        const [newWidth, newHeight] = [
          primaryDimensions.width,
          primaryDimensions.height
        ].map((dim) => parseInt(dim, 10));

        const adjustedDimensions = calculateAdjustedDimensions(
          computed,
          newWidth,
          newHeight
        );

        // Update clone dimensions to match resized primary
        if (cloneElement) {
          cloneElement.style.width = adjustedDimensions.width + "px";
          cloneElement.style.height = adjustedDimensions.height + "px";
        }
      }
    });

    resizeObserver.observe(primaryElement);
  }

  // Remove clone on blur
  function removeCloneElement() {
    if (!cloneElement) return;

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
    cloneElement.remove();
    cloneElement = null;

    // 3. Restore primary editor's position and z-index
    primaryElement.style.position = "";
    primaryElement.style.zIndex = ""; // Clear z-index if it was set
    primaryElement.removeAttribute("data-overlay-mode");

    // 4. Clear parent reference (leave parent positioned for stability)
    if (positionedAncestor) {
      positionedAncestor = null;
    }

    primaryElement.removeEventListener("scroll", handleScroll);

    console.log("Clone editor removed and state restored");
  }

  // Update clone content with optional composition highlighting
  function updateClone(compositionText = null) {
    if (!cloneElement) return;

    // Remove overlay-mode temporarily
    primaryElement.removeAttribute("data-overlay-mode");

    // Sync root element attributes from primary to clone (except id and specific attributes)
    // Clear existing classes and data attributes on clone
    cloneElement.className = primaryElement.className;

    // Copy other attributes (except id, contenteditable, style, and data-overlay-mode)
    Array.from(primaryElement.attributes).forEach((attr) => {
      if (
        !["id", "contenteditable", "style", "data-overlay-mode"].includes(
          attr.name
        )
      ) {
        cloneElement.setAttribute(attr.name, attr.value);
      }
    });

    // Create a range covering just the contents of src
    const range = document.createRange();
    range.selectNodeContents(primaryElement);

    // Clone the primary editor's content
    const clonedContent = range.cloneContents();

    // Merged operation: Copy backgrounds for ALL elements + extra styles for IDs
    const primaryElements = primaryElement.querySelectorAll("*");
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

    primaryElement.setAttribute("data-overlay-mode", "true");

    cloneElement.replaceChildren(clonedContent);
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
          const span = createUnderlinedSpan(composingText);

          // Replace text node with structured content
          const beforeNode = document.createTextNode(beforeText);
          const afterNode = document.createTextNode(afterText);

          parent.replaceChild(afterNode, textNode);
          parent.insertBefore(span, afterNode);
          parent.insertBefore(beforeNode, span);
        }
      } else if (parent && !textNode) {
        // Empty element - create span directly
        const span = createUnderlinedSpan(compositionText);
        parent.appendChild(span);
      }
    }
  }

  function createUnderlinedSpan(textContent) {
    const span = document.createElement("span");
    span.style.borderBottom = "2px dashed #007bff";
    span.textContent = textContent;
    return span;
  }

  // Button functions
  function clearEditor() {
    primaryElement.innerHTML = "";
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
      primaryElement.appendChild(p);
    }

    primaryElement.focus();
  }

  // Make functions globally accessible
  window.clearEditor = clearEditor;
  window.insertMarkedParagraph = insertMarkedParagraph;
});
