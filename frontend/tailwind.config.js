/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Institutional palette. The legacy `kenyan` names are retained so
        // existing surfaces keep working, but they now resolve to the formal
        // brand tokens rather than the national flag colours.
        brand: {
          50: "#F4F6F9",
          100: "#E7ECF2",
          600: "#274764",
          700: "#1D3550",
          800: "#16283A",
          900: "#0F1F2E",
        },
        accent: {
          50: "#F7F2EC",
          400: "#B9946D",
          500: "#A67C52",
          700: "#7A5A3A",
        },
        success: "#2E6B57",
        warning: "#A66A1F",
        danger: "#A33A3A",
        kenyan: {
          red: "#16283A",
          green: "#2E6B57",
          black: "#0F1F2E",
          masai: "#A67C52",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        display: ["Poppins", "system-ui", "sans-serif"],
      },
      borderRadius: {
        xl: "0.875rem",
        "2xl": "1.125rem",
      },
      boxShadow: {
        card: "0 1px 2px rgba(15, 31, 46, 0.04), 0 1px 3px rgba(15, 31, 46, 0.06)",
      },
    },
  },
  plugins: [],
}
