module.exports = {
  apps: [
    {
      name: 'whatsapp-persona-bot',
      script: 'src/index.js',
      cwd: __dirname,
      autorestart: true,
      // Back off instead of giving up (e.g. no internet right after boot).
      exp_backoff_restart_delay: 10000,
      // Exit code 2 = logged out of WhatsApp; restarting won't help.
      stop_exit_codes: [2],
      out_file: 'logs/out.log',
      error_file: 'logs/error.log',
      time: true,
    },
  ],
};
