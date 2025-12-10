import "./style.css";

function updateInfo() {
  const info = document.getElementById("info");
  const activeElement = document.activeElement;
  let selectionRange = "";

  if (
    activeElement.tagName === "TEXTAREA" ||
    (activeElement.tagName === "INPUT" &&
      activeElement.type !== "checkbox" &&
      activeElement.type !== "radio")
  ) {
    const selectionStart = activeElement.selectionStart;
    const selectionEnd = activeElement.selectionEnd;
    selectionRange = `Selection Start: ${selectionStart}, Selection End: ${selectionEnd}`;
  } else if (activeElement.isContentEditable) {
    const selection = window.getSelection();
    if (selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      selectionRange = `Selection Start: ${range.startOffset}, Selection End: ${range.endOffset}`;
    }
  }

  info.innerText = `Active Element: ${activeElement.tagName}, ${
    activeElement.type || "N/A"
  } - ${selectionRange}`;
}

document.addEventListener("focusin", updateInfo);
document.addEventListener("click", updateInfo);
document.addEventListener("keyup", updateInfo);
document.addEventListener("mouseup", updateInfo);
document.addEventListener("selectionchange", updateInfo);
