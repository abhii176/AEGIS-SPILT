import { loadFont as loadFigtree } from "@remotion/google-fonts/Figtree";
import { loadFont as loadSyne } from "@remotion/google-fonts/Syne";

const syne = loadSyne("normal", {
  weights: ["600", "700", "800"],
  subsets: ["latin"],
});

const figtree = loadFigtree("normal", {
  weights: ["400", "500", "600", "700"],
  subsets: ["latin"],
});

export const display = syne.fontFamily;
export const body = figtree.fontFamily;

export const color = {
  bg: "#061412",
  ink: "#0b1c1a",
  fog: "#d8efe8",
  mist: "#a8d5c8",
  sea: "#17a38a",
  gold: "#e8b84a",
  goldDeep: "#c48a1a",
  coral: "#e05a3c",
  pass: "#1f9d6a",
  line: "rgba(216, 239, 232, 0.14)",
  glass: "rgba(8, 28, 25, 0.78)",
};
