import { defineConfig } from 'eslint/config';
import expo from 'eslint-config-expo/flat.js';

export default defineConfig([
  expo,
  { ignores: ['node_modules/**', '.expo/**', 'dist/**', 'tools/**'] },
  {
    files: ['src/domain/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: [
            'react', 'react/*', 'react-native', 'react-native/*', 'expo', 'expo*',
            '**/storage', '**/storage/**', '**/catalog', '**/catalog/**',
            '**/ui', '**/ui/**', '**/ai', '**/ai/**', '**/barcode', '**/barcode/**', '!./barcode', '!../barcode',
          ],
          message: 'The domain layer must remain pure TypeScript and independent of platform and infrastructure modules.',
        }],
      }],
      'import/no-restricted-paths': ['error', {
        zones: ['storage', 'catalog', 'ui', 'ai', 'barcode'].map((folder) => ({
          target: './src/domain', from: `./src/${folder}`,
          message: 'Domain code cannot depend on infrastructure or UI.',
        })),
      }],
    },
  },
]);
