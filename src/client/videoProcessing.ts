import { FFmpeg } from "@ffmpeg/ffmpeg";

// Helper functions to replace @ffmpeg/util functionality

// Enhanced chunk interface to track MediaRecorder sessions
export interface VideoChunk {
    data: Blob;
    sessionId: string;
    timestamp: number;
    sequenceNumber: number;
}

// Group chunks by session and sort by sequence
export interface VideoSession {
    sessionId: string;
    chunks: VideoChunk[];
    startTime: number;
    endTime: number;
}

export class VideoProcessor {
    private ffmpeg: FFmpeg | null = null;
    private initialized = false;

    // Helper method to replace @ffmpeg/util toBlobURL
    private async toBlobURL(url: string, mimeType: string): Promise<string> {
        const response = await fetch(url);
        const blob = await response.blob();
        return URL.createObjectURL(new Blob([blob], { type: mimeType }));
    }

    // Helper method to replace @ffmpeg/util fetchFile
    private async fetchFile(data: Blob): Promise<Uint8Array> {
        const arrayBuffer = await data.arrayBuffer();
        return new Uint8Array(arrayBuffer);
    }

    async initialize(): Promise<void> {
        if (this.initialized) return;

        this.ffmpeg = new FFmpeg();
        
        try {
            // Use jsdelivr CDN which has better CORS support and correct file paths
            let loaded = false;
            
            // Try different CDNs and paths
            const cdnAttempts = [
                {
                    name: "jsdelivr",
                    coreURL: "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.js",
                    wasmURL: "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.wasm",
                },
                {
                    name: "unpkg-umd", 
                    coreURL: "https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.js",
                    wasmURL: "https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.wasm",
                },
                {
                    name: "skypack",
                    coreURL: "https://cdn.skypack.dev/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.js",
                    wasmURL: "https://cdn.skypack.dev/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.wasm",
                },
            ];

            for (const attempt of cdnAttempts) {
                try {
                    console.log(`Trying FFmpeg initialization with ${attempt.name}...`);
                    
                    await this.ffmpeg.load({
                        coreURL: await this.toBlobURL(attempt.coreURL, "text/javascript"),
                        wasmURL: await this.toBlobURL(attempt.wasmURL, "application/wasm"),
                    });
                    
                    loaded = true;
                    console.log(`FFmpeg initialized successfully with ${attempt.name}`);
                    break;
                }
                catch (attemptError) {
                    console.warn(`${attempt.name} failed:`, attemptError);
                    // Continue to next attempt
                }
            }

            if (!loaded) {
                throw new Error("All CDN attempts failed");
            }

            this.initialized = true;
            console.log("FFmpeg initialization completed successfully");
        }
        catch (error) {
            console.error("Failed to initialize FFmpeg:", error);
            throw new Error(`FFmpeg initialization failed: ${error}`);
        }
    }

    /**
     * Classify chunks by MediaRecorder session based on timestamp gaps
     */
    classifyChunks(chunks: Blob[], timestamps: number[]): VideoSession[] {
        const sessions: VideoSession[] = [];
        let currentSessionId = "session_0";
        let currentSessionChunks: VideoChunk[] = [];
        let sessionCount = 0;
        
        // Threshold for detecting new sessions (gaps larger than 5 seconds)
        const SESSION_GAP_THRESHOLD = 5000;

        for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            const timestamp = timestamps[i] || Date.now();
            
            // Check if this chunk starts a new session
            const isNewSession = i > 0 && 
                (timestamp - timestamps[i - 1]) > SESSION_GAP_THRESHOLD;
            
            if (isNewSession && currentSessionChunks.length > 0) {
                // Finalize current session
                const startTime = currentSessionChunks[0].timestamp;
                const endTime = currentSessionChunks[currentSessionChunks.length - 1].timestamp;
                
                sessions.push({
                    sessionId: currentSessionId,
                    chunks: currentSessionChunks,
                    startTime,
                    endTime
                });
                
                // Start new session
                sessionCount++;
                currentSessionId = `session_${sessionCount}`;
                currentSessionChunks = [];
            }
            
            currentSessionChunks.push({
                data: chunk,
                sessionId: currentSessionId,
                timestamp,
                sequenceNumber: currentSessionChunks.length
            });
        }
        
        // Add final session
        if (currentSessionChunks.length > 0) {
            const startTime = currentSessionChunks[0].timestamp;
            const endTime = currentSessionChunks[currentSessionChunks.length - 1].timestamp;
            
            sessions.push({
                sessionId: currentSessionId,
                chunks: currentSessionChunks,
                startTime,
                endTime
            });
        }
        
        console.log(`Classified ${chunks.length} chunks into ${sessions.length} sessions`);
        return sessions;
    }

    /**
     * Concatenate video sessions using FFmpeg without re-encoding
     */
    async concatenateVideoSessions(sessions: VideoSession[], outputFilename = "concatenated_timelapse.webm"): Promise<Blob> {
        if (!this.initialized || !this.ffmpeg) {
            await this.initialize();
        }

        if (sessions.length === 0) {
            throw new Error("No video sessions to concatenate");
        }

        if (sessions.length === 1) {
            // Single session - just concatenate chunks
            const chunks = sessions[0].chunks.map(chunk => chunk.data);
            return new Blob(chunks, { type: "video/webm" });
        }

        console.log(`Concatenating ${sessions.length} video sessions`);

        // Create individual video files for each session
        const sessionFiles: string[] = [];
        
        for (let i = 0; i < sessions.length; i++) {
            const session = sessions[i];
            const sessionFilename = `session_${i}.webm`;
            
            // Concatenate chunks within this session
            const sessionBlob = new Blob(
                session.chunks.map(chunk => chunk.data), 
                { type: "video/webm" }
            );
            
            // Write session video to FFmpeg filesystem
            await this.ffmpeg!.writeFile(sessionFilename, await this.fetchFile(sessionBlob));
            sessionFiles.push(sessionFilename);
        }

        // Create concat demuxer input file
        const concatFileContent = sessionFiles
            .map(filename => `file '${filename}'`)
            .join('\n');
        
        await this.ffmpeg!.writeFile("concat_list.txt", concatFileContent);

        // Run FFmpeg concatenation (copy streams without re-encoding)
        await this.ffmpeg!.exec([
            "-f", "concat",
            "-safe", "0", 
            "-i", "concat_list.txt",
            "-c", "copy",  // Copy streams without re-encoding
            outputFilename
        ]);

        // Read the output file
        const outputData = await this.ffmpeg!.readFile(outputFilename);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const outputBlob = new Blob([outputData as any], { type: "video/webm" });

        // Clean up temporary files
        await this.cleanupFiles([...sessionFiles, "concat_list.txt", outputFilename]);

        console.log(`Video concatenation complete. Output size: ${outputBlob.size} bytes`);
        return outputBlob;
    }

    /**
     * Alternative method: concatenate all chunks directly if they're from compatible streams
     */
    async concatenateChunksDirectly(chunks: Blob[], outputFilename = "direct_concat.webm"): Promise<Blob> {
        if (!this.initialized || !this.ffmpeg) {
            await this.initialize();
        }

        if (chunks.length === 0) {
            throw new Error("No chunks to concatenate");
        }

        if (chunks.length === 1) {
            return chunks[0];
        }

        console.log(`Direct concatenation of ${chunks.length} chunks`);

        // Write all chunks as separate files
        const chunkFiles: string[] = [];
        
        for (let i = 0; i < chunks.length; i++) {
            const chunkFilename = `chunk_${i}.webm`;
            await this.ffmpeg!.writeFile(chunkFilename, await this.fetchFile(chunks[i]));
            chunkFiles.push(chunkFilename);
        }

        // Create concat demuxer input file
        const concatFileContent = chunkFiles
            .map(filename => `file '${filename}'`)
            .join('\n');
        
        await this.ffmpeg!.writeFile("concat_list.txt", concatFileContent);

        // Run FFmpeg concatenation
        await this.ffmpeg!.exec([
            "-f", "concat",
            "-safe", "0",
            "-i", "concat_list.txt", 
            "-c", "copy",  // Copy streams without re-encoding
            outputFilename
        ]);

        // Read the output file
        const outputData = await this.ffmpeg!.readFile(outputFilename);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const outputBlob = new Blob([outputData as any], { type: "video/webm" });

        // Clean up temporary files
        await this.cleanupFiles([...chunkFiles, "concat_list.txt", outputFilename]);

        console.log(`Direct concatenation complete. Output size: ${outputBlob.size} bytes`);
        return outputBlob;
    }

    private async cleanupFiles(filenames: string[]): Promise<void> {
        for (const filename of filenames) {
            try {
                await this.ffmpeg!.deleteFile(filename);
            }
            catch (error) {
                console.warn(`Failed to delete temporary file ${filename}:`, error);
            }
        }
    }
}

export const videoProcessor = new VideoProcessor();
