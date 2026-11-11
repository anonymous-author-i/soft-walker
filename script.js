"use strict";

// Real, manuscript-reported measurements are kept in the HTML panels.
const tabs = [...document.querySelectorAll('[role="tab"]')];
function selectTab(selected) {
  tabs.forEach((tab) => {
    const active = tab === selected;
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
    document.getElementById(tab.getAttribute("aria-controls")).hidden = !active;
  });
}
tabs.forEach((tab, index) => {
  tab.addEventListener("click", () => selectTab(tab));
  tab.addEventListener("keydown", (event) => {
    let next;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = tabs.length - 1;
    if (next === undefined) return;
    event.preventDefault();
    selectTab(tabs[next]);
    tabs[next].focus();
  });
});

// Native image links remain usable when dialog support or JavaScript is absent.
const dialog = document.getElementById("figure-dialog");
const expandedImage = document.getElementById("lightbox-image");
const expandedCaption = document.getElementById("lightbox-caption");
let lightboxTrigger;
if (typeof dialog.showModal === "function") {
  document.querySelectorAll("[data-lightbox]").forEach((link) => {
    link.addEventListener("click", (event) => {
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      const image = link.querySelector("img");
      lightboxTrigger = link;
      expandedImage.src = link.href;
      expandedImage.alt = image.alt;
      expandedCaption.textContent = link.closest("figure").querySelector("figcaption")?.textContent || image.alt;
      dialog.showModal();
      document.body.classList.add("dialog-open");
    });
  });
  dialog.addEventListener("click", (event) => {
    const bounds = dialog.getBoundingClientRect();
    if (event.target === dialog && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom)) dialog.close();
  });
  dialog.addEventListener("close", () => {
    document.body.classList.remove("dialog-open");
    lightboxTrigger?.focus();
  });
}
