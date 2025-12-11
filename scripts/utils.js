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
