module.exports = {
  apps: [
    {
      name: "Reddit Crossposter",
      script: "dist/main.js",
      instances: 1,
      exec_mode: "cluster",
      autorestart: true,
      merge_logs: true,
      log_date_format: "YYYY-MM-DD HH:mm Z",
      log_file: "./log/info.log",
      error_file: "./log/error.log",
    },
    {
      name: "Xvfb",
      interpreter: "none",
      autorestart: true,
      script: "Xvfb",
      args: ":99",
    },
  ],
};
