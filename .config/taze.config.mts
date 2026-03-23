import { defineConfig } from 'taze'

export default defineConfig({
  // Exclude these packages (add as needed).
  exclude: ['eslint-plugin-unicorn'],
  // Interactive mode disabled for automation.
  interactive: false,
  // Use minimal logging similar to ncu loglevel.
  loglevel: 'warn',
  // Only update packages that have been stable for 7 days.
  maturityPeriod: 7,
  // Update mode: 'latest' is similar to ncu's default behavior.
  mode: 'latest',
  // Write controlled by -w flag in update script (check mode by default).
  write: false,
})
