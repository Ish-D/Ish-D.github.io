---
width: 400
height: 500
---

# Image Block Testing

Testing the new unified DSL syntax for image embedding with scale, alignment, caption, and fit options.

## Basic Image Block

[[image(cards/images/koi.jpg)]]
{
Default image at 100% scale with center alignment and cover fit
}

## Scale Control

[[image(cards/images/koi.jpg, scale: 50%)]]
{
Small 50% scale image
}

[[image(cards/images/koi.jpg, scale: 150%)]]
{
Large 150% scale image
}

## Alignment Options

[[image(cards/images/koi.jpg, scale: 75%, align: left)]]
{
Left-aligned image at 75% scale with caption
}

[[image(cards/images/koi.jpg, scale: 75%, align: right)]]
{
Right-aligned image flowing with text
}

[[image(cards/images/koi.jpg, scale: 80%, align: center)]]
{
Center-aligned image (default behavior)
}

## Fit Options

[[image(cards/images/koi.jpg, scale: 60%, fit: cover)]]
{
Cover fit (default - crops to maintain aspect ratio)
}

[[image(cards/images/koi.jpg, scale: 60%, fit: contain)]]
{
Contain fit (shows entire image, may have empty space)
}

[[image(cards/images/koi.jpg, scale: 60%, fit: fill)]]
{
Fill fit (stretches to container, may distort)
}

## Caption in Parameters

[[image(cards/images/koi.jpg, scale: 90%, caption: Koi fish swimming peacefully)]]

This demonstrates using the caption parameter instead of block content.

## Complex Example

[[image(cards/images/koi.jpg, scale: 85%, fit: cover, align: center, caption: Beautiful Koi Pond)]]
{
This detailed caption supports **markdown formatting** including *italics*, [[link(About|links to other cards)]], and can provide rich context about the image. Even though there's a caption parameter, this content takes precedence for detailed descriptions.
}

## Multiple Scales

[[image(cards/images/koi.jpg, scale: 25%, align: left)]]
{
Tiny 25% image
}

Regular paragraph text flows around the small left-aligned image.

[[image(cards/images/koi.jpg, scale: 200%, align: center)]]
{
Very large 200% scale image that demonstrates how scaling affects the native image size
}

More text continues here to show how different scales integrate with the content flow and maintain image quality at native resolution.