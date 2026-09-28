import { defineConfig } from 'vitest/config'

// Tests run against a real Postgres: TEST_DATABASE_URL (a database this suite may wipe), e.g.
// postgres://appoutlet:appoutlet@localhost:5470/accounts_test on AppOutlet's development container.
export default defineConfig({
	test: {
		globalSetup: ['test/support/global-setup.ts'],
		fileParallelism: false,
	},
})
