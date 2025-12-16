// Helper function to copy computed styles from one element to another
// Only needed for elements with IDs (classes and inline styles work automatically)
export function copyComputedStyles(sourceElement, targetElement) {
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

// Calculate adjusted dimensions based on box-sizing model
// If contentOnly is true, returns content-box dimensions
// If false, returns border-box dimensions
export function calculateAdjustedDimensions(
  computed,
  width,
  height,
  contentOnly = true
) {
  const boxSizing = computed.boxSizing;
  let adjustedWidth = width;
  let adjustedHeight = height;

  const factor = contentOnly ? -1 : 1;

  if (boxSizing === "content-box") {
    const paddingLeft = (parseFloat(computed.paddingLeft) || 0) * factor;
    const paddingRight = (parseFloat(computed.paddingRight) || 0) * factor;
    const borderLeft = (parseFloat(computed.borderLeftWidth) || 0) * factor;
    const borderRight = (parseFloat(computed.borderRightWidth) || 0) * factor;
    adjustedWidth =
      width + paddingLeft + paddingRight + borderLeft + borderRight;

    const paddingTop = (parseFloat(computed.paddingTop) || 0) * factor;
    const paddingBottom = (parseFloat(computed.paddingBottom) || 0) * factor;
    const borderTop = (parseFloat(computed.borderTopWidth) || 0) * factor;
    const borderBottom = (parseFloat(computed.borderBottomWidth) || 0) * factor;
    adjustedHeight =
      height + paddingTop + paddingBottom + borderTop + borderBottom;
  }

  return { width: adjustedWidth, height: adjustedHeight };
}

// Helper function to get the path to a node
export function getNodePath(node, root) {
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
export function getNodeByPath(path, root) {
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

// Find nearest block-level ancestor that can serve as positioning context
export function findNearestAncestor(element) {
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

export function onlyToggledSpecialClass(oldClass, newClass, special) {
  const oldSet = new Set(oldClass.split(/\s+/).filter(Boolean));
  const newSet = new Set(newClass.split(/\s+/).filter(Boolean));

  const added = [...newSet].filter((c) => !oldSet.has(c));
  const removed = [...oldSet].filter((c) => !newSet.has(c));

  // Ignore if the delta is exactly [+special] or [-special]
  return (
    (added.length >= 1 && added.includes(special) && removed.length === 0) ||
    (removed.length >= 1 && removed.includes(special) && added.length === 0)
  );
}

// Apply custom css to an editor element
export function applyCustomCSS(element, styles) {
  Object.entries(styles).forEach(([property, value]) => {
    // Add 'px' suffix for numeric values (except zIndex)
    const formattedValue =
      typeof value === "number" && property !== "zIndex" ? `${value}px` : value;
    element.style[property] = formattedValue;
  });
}

export function isHeightChanging(element) {
  return element.scrollHeight != parseInt(element.style.height);
}
