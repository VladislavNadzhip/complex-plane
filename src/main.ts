import "katex/dist/katex.min.css";
import "./styles/main.css";
import { registerManimEases } from "./core/manimEase";
import { AppController } from "./ui/AppController";

registerManimEases();

document.addEventListener("DOMContentLoaded", () => {
  new AppController();
});