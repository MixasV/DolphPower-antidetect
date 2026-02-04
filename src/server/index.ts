import { initializeDatabase } from '../database/schema';
import { createApp, startServer } from './app';

const API_PORT = process.env.API_PORT ? parseInt(process.env.API_PORT) : 3001;

async function main() {
    try {
        console.log('Starting AntiDetect Browser API Server...\n');

        // Initialize database
        console.log('Initializing database...');
        const db = await initializeDatabase();

        // Create Express app
        const app = createApp(db);

        // Start server
        await startServer(app, API_PORT);

        console.log('Server started successfully!');
        console.log('Press Ctrl+C to stop\n');

        // Graceful shutdown
        process.on('SIGINT', async () => {
            console.log('\nShutting down gracefully...');
            db.close((err) => {
                if (err) {
                    console.error('Error closing database:', err);
                } else {
                    console.log('Database closed');
                }
                process.exit(0);
            });
        });

        process.on('SIGTERM', async () => {
            console.log('\nShutting down gracefully...');
            db.close((err) => {
                if (err) {
                    console.error('Error closing database:', err);
                }
                process.exit(0);
            });
        });

    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}

main();
