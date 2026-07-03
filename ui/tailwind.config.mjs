import plugin from "tailwindcss/plugin";
import containerQueries from "@tailwindcss/container-queries";
import typography from "@tailwindcss/typography";
import forms from "@tailwindcss/forms";
import tailwindcssAnimate from "tailwindcss-animate";
import headlessui from "@headlessui/tailwindcss";

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: ["class", '[data-joy-color-scheme="dark"]'],
  theme: {
    extend: {
      fontSize: {
        xxs: [
          "0.75rem", // 12px
          {
            lineHeight: "1.125rem", // 18px
          },
        ],
        xs: [
          "0.8125rem", // 13px
          {
            lineHeight: "1.125rem", // 18px
          },
        ],
        sm: [
          "0.875rem", // 14px
          {
            lineHeight: "1.25rem", // 20px
          },
        ],
        base: [
          "1rem", // 16px
          {
            lineHeight: "1.5rem", // 24px
          },
        ],
        lg: [
          "1.125rem", // 18px
          {
            lineHeight: "1.75rem", // 28px
            letterSpacing: "-0.01em", // tracking-tight
          },
        ],
        xl: [
          "1.25rem", // 20px
          {
            lineHeight: "1.875rem", // 30px
            letterSpacing: "-0.01em", // tracking-tight
          },
        ],
      },
      fontFamily: {
        mono: [
          `"Fira Code"`,
          `ui-monospace`,
          `SFMono-Regular`,
          `Menlo`,
          `Monaco`,
          `Consolas`,
          `"Liberation Mono"`,
          `"Courier New"`,
          `monospace`,
        ],
      },
      letterSpacing: {
        tighter: "-0.04em",
        tight: "-0.03em",
        snug: "-0.02em",
        normal: "0",
        wide: "0.03em",
      },
      lineHeight: {
        tight: "1.20",
      },
      backgroundImage: {
        navMenu: "linear-gradient(132deg, #4C1D95 0%, #A855F7 100%)",
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        xs: "3px",
      },
      boxShadow: {
        xs: "0 1px 2px 0 rgba(0, 0, 0, 0.05)",
      },
      backgroundColor: {
        primary: "hsl(var(--primary) / <alpha-value>)",
        "primary-hover": "hsl(var(--primary) / 0.9)",
        secondary: "hsl(var(--secondary) / <alpha-value>)",
        "secondary-hover": "hsl(var(--secondary) / 0.8)",
        tertiary: "hsl(var(--muted) / <alpha-value>)",
        quaternary: "hsl(var(--accent) / <alpha-value>)",

        "brand-primary": "hsl(var(--primary) / <alpha-value>)",
        "brand-primary-hover": "hsl(var(--primary) / 0.9)",
        "brand-secondary": "hsl(var(--accent) / <alpha-value>)",
        "brand-tertiary": "hsl(var(--muted) / <alpha-value>)",

        "success-primary": "hsl(var(--primary) / 0.1)",
        "success-secondary": "hsl(var(--accent) / <alpha-value>)",
        "success-strong": "hsl(var(--primary) / <alpha-value>)",
        "error-primary": "hsl(var(--destructive) / 0.1)",
        "error-secondary": "hsl(var(--destructive) / 0.16)",
        "error-strong": "hsl(var(--destructive) / <alpha-value>)",
        "error-strong-hover": "hsl(var(--destructive) / 0.9)",
        "warning-primary": "rgb(245 158 11 / 0.1)",
        "warning-secondary": "rgb(245 158 11 / 0.16)",
        "warning-strong": "rgb(217 119 6 / <alpha-value>)",
      },
      borderColor: {
        primary: "hsl(var(--primary) / <alpha-value>)",
        secondary: "hsl(var(--border) / <alpha-value>)",
        tertiary: "hsl(var(--muted-foreground) / 0.18)",
        error: "hsl(var(--destructive) / 0.28)",
        "error-strong": "hsl(var(--destructive) / <alpha-value>)",
        brand: "hsl(var(--primary) / <alpha-value>)",
        "brand-strong": "hsl(var(--primary) / <alpha-value>)",
        "brand-subtle": "hsl(var(--primary) / 0.2)",
        strong: "hsl(var(--foreground) / 0.18)",
        warning: "rgb(245 158 11 / 0.35)",
        success: "hsl(var(--primary) / 0.35)",
        "status-green": "hsl(var(--primary) / 0.35)",
        "status-orange": "rgb(217 119 6 / 0.35)",
        "status-yellow": "rgb(245 158 11 / 0.35)",
        "status-red": "hsl(var(--destructive) / 0.35)",
      },
      textColor: {
        primary: {
          DEFAULT: "hsl(var(--primary) / <alpha-value>)",
          foreground: "hsl(var(--primary-foreground) / <alpha-value>)",
        },
        secondary: "hsl(var(--muted-foreground) / <alpha-value>)",
        tertiary: "hsl(var(--muted-foreground) / 0.74)",
        quaternary: "hsl(var(--muted-foreground) / 0.58)",
        disabled: "hsl(var(--muted-foreground) / 0.45)",
        error: "hsl(var(--destructive) / <alpha-value>)",
        warning: "rgb(180 83 9 / <alpha-value>)",
        success: "hsl(var(--primary) / <alpha-value>)",
        placeholder: "hsl(var(--muted-foreground) / 0.72)",
        "brand-primary": "hsl(var(--primary) / <alpha-value>)",
        "brand-secondary": "hsl(var(--primary) / 0.78)",
        "brand-tertiary": "hsl(var(--primary) / 0.58)",
        "brand-disabled": "hsl(var(--primary) / 0.38)",
        "status-green": "hsl(var(--primary) / <alpha-value>)",
        "status-orange": "rgb(217 119 6 / <alpha-value>)",
        "status-yellow": "rgb(161 98 7 / <alpha-value>)",
        "status-red": "hsl(var(--destructive) / <alpha-value>)",
        "button-primary": "hsl(var(--primary-foreground) / <alpha-value>)",
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar))",
        },
        chart: {
          1: "hsl(var(--chart-1))",
          2: "hsl(var(--chart-2))",
          3: "hsl(var(--chart-3))",
          4: "hsl(var(--chart-4))",
          5: "hsl(var(--chart-5))",
        },
        ls: {
          blue: "hsl(var(--primary))",
          black: "hsl(var(--ls-black))",
          green: {
            600: "hsl(var(--primary))",
          },
          white: "var(--white)",
          black: "var(--black)",
          red: {
            25: "var(--red-25)",
            50: "var(--red-50)",
            100: "var(--red-100)",
            200: "var(--red-200)",
            300: "var(--red-300)",
            400: "var(--red-400)",
            500: "var(--red-500)",
            600: "var(--red-600)",
            700: "var(--red-700)",
            800: "var(--red-800)",
            900: "var(--red-900)",
            950: "var(--red-950)",
          },
          orange: {
            25: "var(--orange-25)",
            50: "var(--orange-50)",
            100: "var(--orange-100)",
            200: "var(--orange-200)",
            300: "var(--orange-300)",
            400: "var(--orange-400)",
            500: "var(--orange-500)",
            600: "var(--orange-600)",
            700: "var(--orange-700)",
            800: "var(--orange-800)",
            900: "var(--orange-900)",
            950: "var(--orange-950)",
          },
          gray: {
            50: "var(--gray-50)",
            100: "var(--gray-100)",
            200: "var(--gray-200)",
            300: "var(--gray-300)",
            400: "var(--gray-400)",
            500: "var(--gray-500)",
            600: "var(--gray-600)",
            700: "var(--gray-700)",
            800: "var(--gray-800)",
            900: "var(--gray-900)",
            950: "var(--gray-950)",
          },
          green: {
            25: "#fbfaff",
            50: "#f6f3fb",
            100: "#ece7f8",
            200: "#ded8e8",
            300: "#cbbde6",
            400: "#a78bfa",
            500: "#7c3aed",
            600: "#6d28d9",
            700: "#5b21b6",
            800: "#4c1d95",
            900: "#2e1065",
            950: "#1e1233",
          },
        },
        brand: {
          green: {
            25: "#fbfaff",
            50: "#f6f3fb",
            100: "#ece7f8",
            200: "#ded8e8",
            300: "#cbbde6",
            400: "#a78bfa",
            500: "#7c3aed",
            600: "#6d28d9",
            700: "#5b21b6",
            800: "#4c1d95",
            900: "#2e1065",
            950: "#1e1233",
          },
        },
      },
      keyframes: {
        hide: {
          from: { opacity: 1 },
          to: { opacity: 0 },
        },
        slideIn: {
          from: {
            transform: "translateX(calc(100% + var(--viewport-padding)))",
          },
          to: { transform: "translateX(0)" },
        },
        swipeOut: {
          from: { transform: "translateX(var(--radix-toast-swipe-end-x))" },
          to: { transform: "translateX(calc(100% + var(--viewport-padding)))" },
        },
      },
      animation: {
        hide: "hide 100ms ease-in",
        slideIn: "slideIn 150ms cubic-bezier(0.16, 1, 0.3, 1)",
        swipeOut: "swipeOut 100ms ease-out",
      },
    },
    typography: {
      playground: {
        css: {
          "h1, h2, h3, h4, h5, h6": {
            fontWeight: "bold",
          },
          h1: {
            fontSize: "24px",
          },
          h2: {
            fontSize: "20px",
          },
          h3: {
            fontSize: "18px",
          },
          h4: {
            fontSize: "16px",
          },
          h5: {
            fontSize: "14px",
          },
          h6: {
            fontSize: "12px",
          },
          ul: {
            marginLeft: "20px !important",
            listStyleType: "disc !important",
          },
          ol: {
            marginLeft: "20px !important",
            listStyleType: "decimal !important",
          },
          a: {
            color: "#4C1D95",
            textDecoration: "underline",
            "&:hover": {
              textDecoration: "underline",
            },
          },
          table: {
            width: "100%",
            borderCollapse: "collapse",
            th: {
              padding: "0.5rem",
              border: "1px solid var(--gray-100)",
              fontWeight: "bold",
              textAlign: "left",
            },
            td: {
              padding: "0.5rem",
              border: "1px solid var(--gray-100)",
            },
          },
          blockquote: {
            borderLeft: "2px solid var(--gray-100)",
            paddingLeft: "1rem",
            marginLeft: "0",
            fontStyle: "italic",
          },

          "s, strike, del": {
            textDecoration: "line-through",
          },
        },
      },
    },
  },
  plugins: [
    containerQueries,
    typography,
    forms,
    tailwindcssAnimate,
    headlessui,
    plugin(({ addUtilities, addBase }) => {
      addBase({
        input: {
          borderWidth: "0",
          padding: "0",
        },
        // Global scrollbar styles for all scrollable elements
        "html, body, *": {
          "scrollbar-width": "thin",
          "scrollbar-color":
            "hsl(var(--muted-foreground) / 0.18) hsl(var(--background))",
        },
        "html::-webkit-scrollbar, body::-webkit-scrollbar, *::-webkit-scrollbar":
          {
            width: "8px",
            background: "hsl(var(--background))",
          },
        "html::-webkit-scrollbar-track, body::-webkit-scrollbar-track, *::-webkit-scrollbar-track":
          {
            background: "hsl(var(--background))",
          },
        "html::-webkit-scrollbar-thumb, body::-webkit-scrollbar-track, *::-webkit-scrollbar-thumb":
          {
            background: "hsl(var(--muted-foreground) / 0.18)",
            "border-radius": "4px",
          },
        "html::-webkit-scrollbar-thumb:hover, body::-webkit-scrollbar-thumb:hover, *::-webkit-scrollbar-thumb:hover":
          {
            background: "hsl(var(--muted-foreground) / 0.32)",
          },
      });
      addUtilities({
        ".no-scrollbar": {
          "scrollbar-width": "none",
          "&::-webkit-scrollbar": {
            display: "none",
          },
        },
      });

      // https://github.com/tailwindlabs/tailwindcss/discussions/12127
      addUtilities({
        ".break-anywhere": {
          "@supports (overflow-wrap: anywhere)": {
            "overflow-wrap": "anywhere",
          },
          "@supports not (overflow-wrap: anywhere)": {
            "word-break": "break-word",
          },
        },
      });

      addUtilities({
        ".no-number-spinner": {
          MozAppearance: "textfield",
          "&::-webkit-outer-spin-button": {
            WebkitAppearance: "none !important",
            margin: 0,
          },
          "&::-webkit-inner-spin-button": {
            WebkitAppearance: "none !important",
            margin: 0,
          },
        },
      });

      addUtilities({
        ".text-security": {
          textSecurity: "disc",
          WebkitTextSecurity: "disc",
          MozTextSecurity: "disc",
        },
      });

      addUtilities({
        ".display-sm": {
          fontSize: "1rem", // 16px
          lineHeight: "1.5rem", // 24px
          fontWeight: "600", // semibold
        },
        ".display-base": {
          fontSize: "1.5rem", // 24px
          lineHeight: "2rem", // 32px
          letterSpacing: "-0.01em", // tracking-tight
        },
        ".display-lg": {
          fontSize: "1.875rem", // 30px
          lineHeight: "2.375rem", // 38px
          letterSpacing: "-0.01em", // tracking-tight
        },
        ".display-xl": {
          fontSize: "2.25rem", // 36px
          lineHeight: "2.75rem", // 44px
          letterSpacing: "-0.01em", // tracking-tight
        },
        ".display-2xl": {
          fontSize: "3rem", // 48px
          lineHeight: "3.75rem", // 60px
          letterSpacing: "-0.01em", // tracking-tight
        },
        ".caps-label-sm": {
          fontSize: "0.875rem", // 14px
          lineHeight: "1.25rem", // 20px
          letterSpacing: "0.02625rem", // 0.42px
          textTransform: "uppercase",
        },
        ".caps-label-xs": {
          fontSize: "0.75rem", // 14px
          lineHeight: "1.125rem", // 20px
          letterSpacing: "0.0225rem", // 0.42px
          textTransform: "uppercase",
        },
      });
    }),
  ],
};
