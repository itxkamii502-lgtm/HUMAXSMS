module.exports = {
  apps: [
    {
      name: 'humex-sms',
      script: 'server.js',
      cwd: __dirname,
      exec_mode: 'fork',
      instances: 1, // Single fork required for in-memory DB cache & WebSocket hub
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      kill_timeout: 10000,
      listen_timeout: 8000,
      max_restarts: 10,
      min_uptime: '10s',
      exp_backoff_restart_delay: 200,
      merge_logs: true,
      time: true,
      env: {
        // server.js automatically loads .env; only NODE_ENV is defaulted here
        NODE_ENV: 'production'
      }
    }
  ]
};
