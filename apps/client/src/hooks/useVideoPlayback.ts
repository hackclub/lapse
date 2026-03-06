import { getVideoAtSequenceTime } from "@/video";
import { SyntheticEvent, useCallback, useEffect, useRef, useState } from "react";

export interface VideoPlayback {
    videoRef: React.RefObject<HTMLVideoElement | null>;
    time: number;
    playing: boolean;
    totalTime: number;
    seekTo: (time: number) => void;
    togglePlayback: () => void;
    handleTimeUpdate: (ev: SyntheticEvent<HTMLVideoElement>) => void;
    handleEnded: () => void;
    getCurrentTime: () => number;
}

const PLAYBACK_RATE = 16;

export function useVideoPlayback(sessions: { url: string; duration: number }[] | null): VideoPlayback {
    const videoRef = useRef<HTMLVideoElement>(null);

    const [time, setTime] = useState(0);
    const [playing, setPlaying] = useState(false);

    const timeBaseRef = useRef(0);
    const playingRef = useRef(false);
    playingRef.current = playing;

    const totalTime = sessions?.reduce((a, x) => a + x.duration, 0) ?? 0;

    const seekTo = useCallback((newTime: number) => {
        if (!sessions)
            return;

        const session = getVideoAtSequenceTime(newTime, sessions);
        const video = videoRef.current;

        if (video) {
            if (session.url !== video.src)
                video.src = session.url;

            video.currentTime = newTime - session.timeBase;
        }

        timeBaseRef.current = session.timeBase;
        setTime(newTime);
    }, [sessions]);

    useEffect(() => {
        if (sessions)
            seekTo(0);
    }, [sessions, seekTo]);

    const togglePlayback = useCallback(() => {
        if (!sessions)
            return;

        const video = videoRef.current;
        if (!video)
            return;

        if (playingRef.current) {
            video.pause();
            setPlaying(false);
        }
        else {
            if (timeBaseRef.current + video.currentTime >= totalTime) {
                const session = getVideoAtSequenceTime(0, sessions);
                video.src = session.url;
                video.currentTime = 0;
                timeBaseRef.current = session.timeBase;
                setTime(0);
            }

            video.playbackRate = PLAYBACK_RATE;
            video.play();
            setPlaying(true);
        }
    }, [sessions, totalTime]);

    const handleEnded = useCallback(() => {
        if (!sessions)
            return;

        const video = videoRef.current;
        if (!video)
            return;

        const nextTime = timeBaseRef.current + (video.duration ?? 0);

        if (nextTime < totalTime) {
            const session = getVideoAtSequenceTime(nextTime, sessions);
            video.src = session.url;
            video.currentTime = 0;
            timeBaseRef.current = session.timeBase;
            setTime(nextTime);
            video.playbackRate = PLAYBACK_RATE;
            video.play();
        }
        else {
            setTime(totalTime);
            setPlaying(false);
        }
    }, [sessions, totalTime]);

    const handleTimeUpdate = useCallback((ev: SyntheticEvent<HTMLVideoElement>) => {
        setTime(timeBaseRef.current + ev.currentTarget.currentTime);
    }, []);

    const getCurrentTime = useCallback(() => {
        if (!sessions)
            return 0;

        const video = videoRef.current;
        if (!video || !playingRef.current)
            return time;

        let base = 0;
        for (const s of sessions) {
            if (s.url === video.src)
                return base + video.currentTime;

            base += s.duration;
        }

        return 0;
    }, [sessions, time]);

    return {
        videoRef,
        time,
        playing,
        totalTime,
        seekTo,
        togglePlayback,
        handleTimeUpdate,
        handleEnded,
        getCurrentTime,
    };
}
