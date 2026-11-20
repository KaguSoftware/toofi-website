/** `node --import ./scripts/blender/film/ts-register.mjs …`: registers ts-loader.mjs. */
import { register } from "node:module";

register("./ts-loader.mjs", import.meta.url);
