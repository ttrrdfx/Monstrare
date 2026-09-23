const stateLabels = {
  available: "可更新",
  loading: "檢查中",
  conflict: "衝突阻擋",
  error: "網路錯誤",
  success: "更新完成",
};

function setState(state) {
  document.body.dataset.state = state;
  document.querySelectorAll("[data-demo-state]").forEach((button) => {
    button.classList.toggle("active", button.dataset.demoState === state);
  });
  document.querySelectorAll("[data-state-label]").forEach((node) => {
    node.textContent = stateLabels[state] || state;
  });
}

document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-demo-state]");
  if (button) setState(button.dataset.demoState);
});

setState(document.body.dataset.state || "available");
