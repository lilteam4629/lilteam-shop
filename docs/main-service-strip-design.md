# Main shop service strip

[Editable Figma design](https://www.figma.com/design/sSk2J7ztYn8lodrxtD0La4?node-id=2-2)

The review frame contains desktop and mobile instances in light and dark themes.
Source components, scoped semantic variables and Prompt text styles remain editable.

The EJS partial uses the shop's configured hours, name and tagline. The live clock
uses Asia/Bangkok. Existing clock and arrow SVG geometry is reused from the site.
The contact action has a 44px hit target with a smaller visible pill or circle.

Desktop height: 62px. Mobile height: 79px. The small mobile layout fits 320px.
The clock orbit rotates continuously in 3 seconds; the light sweep takes 4 seconds;
the status ring pulses in 2 seconds. Animations pause outside the viewport or while
the document is hidden. Reduced motion retains readable static content.

The main shop and all rental storefronts render this shared component. Each shop
uses its own configured name, hours, tagline and theme. The existing setting to
hide the service-hours bar remains available in each shop's storefront settings.
