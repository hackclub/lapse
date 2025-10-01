# Video Stream Persistence Implementation

## Overview
Implemented IndexedDB-based persistence for timelapse video streams to prevent data loss during power outages or browser crashes.

## Changes Made

### 1. Created IndexedDB Storage Utility (`src/utils/timelapseStorage.ts`)
- **TimelapseStorage class** with methods for managing video chunks
- **StoredTimelapse interface** defining the data structure
- **Automatic persistence** of video chunks, frame counts, and metadata
- **Recovery capabilities** for resuming interrupted recordings

### 2. Modified Timelapse Creation Page (`src/pages/timelapse/create.tsx`)
- **Recovery logic** on component mount to detect active timelapses
- **Real-time persistence** of video chunks in `MediaRecorder.ondataavailable`
- **Frame count updates** stored in IndexedDB on each frame capture
- **Cleanup logic** when recordings are completed or cancelled
- **Visual indicator** for recovery status ("RECOVERING" state)

## Key Features

### Persistence Strategy
- **Every video chunk** is immediately stored in IndexedDB when available
- **Frame count** is updated in storage on each frame capture
- **Metadata** (name, description, start time) persisted on recording start
- **Active recording flag** allows detection of interrupted sessions

### Recovery Process
1. On page load, check for any active timelapses in IndexedDB
2. If found, restore all state (chunks, frame count, metadata)
3. Display "RECOVERING" status during restoration
4. Resume recording capabilities with existing data

### Data Structure
```typescript
interface StoredTimelapse {
    id: string;           // Unique identifier
    name: string;         // User-provided name
    description: string;  // User-provided description  
    startedAt: string;    // ISO timestamp
    chunks: Blob[];       // Video data chunks
    frameCount: number;   // Number of frames captured
    isActive: boolean;    // Whether recording is in progress
}
```

### Benefits
- **No data loss** during unexpected interruptions
- **Seamless recovery** when returning to the app
- **Inter-frame compression** preserved by storing video stream chunks
- **Minimal performance impact** with efficient IndexedDB operations

## Browser Compatibility
- Works in all modern browsers that support IndexedDB
- Graceful fallback behavior if IndexedDB is unavailable
- No external dependencies required

## Future Enhancements
- Could add encryption for sensitive timelapses
- Optional cloud backup integration
- Automatic cleanup of old completed timelapses
- Progress indicators for large recovery operations
