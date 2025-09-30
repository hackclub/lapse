import type { Config } from "tailwindcss";

const config: Config = {
    content: [
        "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
        "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
        "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    ],
    darkMode: "class",
    theme: {
        extend: {
            colors: {
                darker: "#121217",
                dark: "#17171d",
                darkless: "#252429",
                black: "#1f2d3d",
                steel: "#273444",
                slate: "#3c4858",
                muted: "#8492a6",
                smoke: "#e0e6ed",
                snow: "#f9fafc",
                white: "#ffffff",
                red: "#ec3750",
                orange: "#ff8c37",
                yellow: "#f1c40f",
                green: "#33d6a6",
                cyan: "#5bc0de",
                blue: "#338eda",
                purple: "#a633d6",
                twitter: "#1da1f2",
                facebook: "#3b5998",
                instagram: "#e1306c",
                text: "#1f2d3d",
                background: "#ffffff",
                elevated: "#ffffff",
                sheet: "#f9fafc",
                sunken: "#e0e6ed",
                border: "#e0e6ed",
                placeholder: "#8492a6",
                secondary: "#3c4858",
                primary: "#ec3750",
                accent: "#338eda",
            },
            boxShadow: {
                text: "0 1px 2px rgba(0, 0, 0, 0.25), 0 2px 4px rgba(0, 0, 0, 0.125)",
                small: "0 1px 2px rgba(0, 0, 0, 0.0625), 0 2px 4px rgba(0, 0, 0, 0.0625)",
                card: "0 4px 8px rgba(0, 0, 0, 0.125)",
                elevated: "0 1px 2px rgba(0, 0, 0, 0.0625), 0 8px 12px rgba(0, 0, 0, 0.125)",
            },
        },
    },
    plugins: [],
};

export default config;
