import React from "react";

import { Code } from "@/client/components/ui/Code";

interface TextSegment {
    text: string;
    formatting?: {
        bold?: boolean;
        italic?: boolean;
        strikethrough?: boolean;
        code?: boolean;
        codeIndex?: number;
    };
}

export function markdownToJsx(markdown: string): React.ReactNode {
    const codeBlocks: string[] = [];
    let segments: TextSegment[] = [];
    let currentText = "";
    let i = 0;

    while (i < markdown.length) {
        if (markdown[i] === "`") {
            // Found code block start
            if (currentText) {
                segments.push({ text: currentText });
                currentText = "";
            }

            i++; // Skip opening `
            let codeContent = "";
            while (i < markdown.length && markdown[i] !== "`") {
                codeContent += markdown[i];
                i++;
            }
            i++; // Skip closing `

            const codeIndex = codeBlocks.length;
            codeBlocks.push(codeContent);
            segments.push({
                text: "",
                formatting: { code: true, codeIndex }
            });
        }
        else {
            currentText += markdown[i];
            i++;
        }
    }

    if (currentText) {
        segments.push({ text: currentText });
    }

    segments = segments.flatMap(segment => {
        if (segment.formatting?.code) {
            return [segment];
        }

        return parseFormattingInText(segment.text);
    });

    return (
        <>
            {segments.map((segment, index) => {
                if (segment.formatting?.code) {
                    return <Code key={index}>{codeBlocks[segment.formatting.codeIndex!]}</Code>;
                }

                let content: React.ReactNode = segment.text;

                if (segment.formatting?.bold) {
                    content = <strong>{content}</strong>;
                }
                if (segment.formatting?.italic) {
                    content = <em>{content}</em>;
                }
                if (segment.formatting?.strikethrough) {
                    content = <s>{content}</s>;
                }

                return <React.Fragment key={index}>{content}</React.Fragment>;
            })}
        </>
    );
}

function parseFormattingInText(text: string): TextSegment[] {
    const segments: TextSegment[] = [];
    let remaining = text;

    while (remaining.length > 0) {
        // Try to find the earliest formatting marker
        const boldMatch = remaining.match(/(\*\*|__)(.+?)\1/);
        const italicMatch = remaining.match(/(^|[^A-Za-z0-9_])(\*|_)([^*_]+?)\2(?![A-Za-z0-9_])/);
        const strikethroughMatch = remaining.match(/~~(.+?)~~/);

        const matches = [
            { match: boldMatch, type: "bold" as const, startOffset: 0, fullLength: 0 },
            { match: italicMatch, type: "italic" as const, startOffset: 0, fullLength: 0 },
            { match: strikethroughMatch, type: "strikethrough" as const, startOffset: 0, fullLength: 0 }
        ]
            .filter(m => m.match)
            .map(m => ({
                ...m,
                startOffset: m.match!.index || 0,
                fullLength: m.match![0].length
            }))
            .sort((a, b) => a.startOffset - b.startOffset);

        if (matches.length === 0) {
            // No more formatting, add remaining text
            if (remaining) {
                segments.push({ text: remaining });
            }
            
            break;
        }

        const earliest = matches[0];
        const beforeText = remaining.slice(0, earliest.startOffset);

        // Add text before the formatting
        if (beforeText) {
            segments.push({ text: beforeText });
        }

        let formattedText =
            earliest.type === "bold" ? earliest.match![2] :
            earliest.type === "italic" ? earliest.match![3] :
            earliest.type === "strikethrough" ? earliest.match![1] :
            "";

        segments.push({
            text: formattedText,
            formatting: { [earliest.type]: true }
        });

        // Continue with remaining text
        remaining = remaining.slice(earliest.startOffset + earliest.fullLength);
    }

    return segments;
}
