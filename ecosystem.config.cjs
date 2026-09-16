module.exports = {
  apps: [
    {
      name: 'whatsapp-persona-bot',
      script: 'src/index.js',
      cwd: __dirname,
      autorestart: true,
      restart_delay: 10000,
      max_restarts: 20,
      // Exit code 2 = logged out of WhatsApp; restarting won't help.
      stop_exit_codes: [2],
      out_file: 'logs/out.log',
      error_file: 'logs/error.log',
      time: true,
    },
  ],
};
