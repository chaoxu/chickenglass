const fontLoaders = {
  ".ttf": "file",
  ".woff": "file",
  ".woff2": "file",
};

export default [
  {
    name: "coflat/editor (JS)",
    path: "dist/editor.mjs",
    limit: "10 MB",
  },
  {
    name: "coflat/editor (CSS)",
    path: "dist/editor.css",
    limit: "1 MB",
    modifyEsbuildConfig(config) {
      return {
        ...config,
        loader: {
          ...config.loader,
          ...fontLoaders,
        },
      };
    },
  },
];
