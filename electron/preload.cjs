const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("complexPlane", {
  platform: process.platform,
});