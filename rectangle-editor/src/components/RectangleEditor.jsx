import React, { useState, useRef, useEffect, useCallback, useLayoutEffect } from 'react';
import { Pin, PinOff, Trash2 } from 'lucide-react';

import ReactMarkdown from 'react-markdown';
import rehypeRaw from "rehype-raw";
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css'; // Import Katex CSS

const RectangleEditor = () => {
  // Setup Stage
  const [selectedId, setSelectedId] = useState(null);
  const [action, setAction] = useState(null);
  const [startPoint, setStartPoint] = useState({ x: 0, y: 0 });
  const [rect, setrect] = useState(null);
  const [lastAngle, setLastAngle] = useState(0);
  const [hoveredCorner, setHoveredCorner] = useState({ id: null, corner: null });
  const [pinnedRectangles, setPinnedRectangles] = useState(new Set());
  const [hoveredFlap, setHoveredFlap] = useState(null);
  const [selectionOrder, setSelectionOrder] = useState([]);

  const [activeTouches, setActiveTouches] = useState(new Map());
  const [initialTouchDistance, setInitialTouchDistance] = useState(null);
  const [initialTouchAngle, setInitialTouchAngle] = useState(null);
  const [initialScale, setInitialScale] = useState(1);
  const [initialRotation, setInitialRotation] = useState(0);
  const [lastTouchInfo, setLastTouchInfo] = useState(null);
  const [selectedOperation, setSelectedOperation] = useState(null);
  
  const [isDraggingCanvas, setIsDraggingCanvas] = useState(false);
  const [isScrollingRectangle, setIsScrollingRectangle] = useState(false);
  const lastMousePos = useRef({ x: 0, y: 0 });

  const [canvasRotation, setCanvasRotation] = useState(0);
  const [isRotatingCanvas, setIsRotatingCanvas] = useState(false);
  const rotationStartPoint = useRef({ x: 0, y: 0 });
  const longPressTimer = useRef(null);
  const touchStartTime = useRef(0);
  const touchStartPosition = useRef({ x: 0, y: 0 });
  const isMobileInteraction = useRef(false);

  const canvasRef = useRef(null);
  const scrollPositions = useRef({});
  const activeRectangleRef = useRef(null);
  
  const checkIsMobile = () => {
    let hasTouchScreen = false;
    
    // First check
    if ("maxTouchPoints" in navigator) {
      hasTouchScreen = navigator.maxTouchPoints > 0;
    } else if ("msMaxTouchPoints" in navigator) {
      hasTouchScreen = navigator.msMaxTouchPoints > 0;
    }
    
    // Second check
    const mQ = window.matchMedia && window.matchMedia("(pointer:coarse)");
    if (mQ && mQ.media === "(pointer:coarse)") {
      hasTouchScreen = !!mQ.matches;
    }
    
    // Third check
    if ('orientation' in window) {
      hasTouchScreen = true;
    }

    // Fourth check
    const userAgent = navigator.userAgent.toLowerCase();
    const isMobileUserAgent = /mobile|android|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(userAgent);

    // Screen size check
    const isSmallScreen = window.innerWidth <= 768;

    return hasTouchScreen || isMobileUserAgent || isSmallScreen;
  };

  const [isMobile, setIsMobile] = useState(false);
  
  useEffect(() => {
    const checkMobileStatus = () => {
      setIsMobile(checkIsMobile());
    };
    
    checkMobileStatus();
    window.addEventListener('resize', checkMobileStatus);
    
    return () => {
      window.removeEventListener('resize', checkMobileStatus);
    };
  }, []);

  const [viewport, setViewport] = useState({
    x: 0,
    y: 0,
    scale: 1
  });

  // Initialization
  let initialWidth = window.innerWidth - ((isMobile ? 1.00 : 0.8) * window.innerWidth);
  let initialHeight = window.innerHeight - (2 * 0.05 * window.innerHeight);
  let font = 'Palatino'
  let fontSize = isMobile ? 18 : 16; // Slightly larger font on mobile
  
  const getInitialRectangles = () => {
    const now = Date.now();
    const centerWidth = window.innerWidth - (2 * (isMobile ? 0.05 : 0.3) * window.innerWidth);
    const centerHeight = window.innerHeight - (2 * 0.05 * window.innerHeight);
    
    // Define which markdown files should be loaded for each rectangle
    // The key is the rectangle index (0-based), and the value is the markdown filename
    const initialMarkdowns = {
      0: 'landing.md',
      // 1: 'controls.md',
      // 2: 'todo.md'
    };
    
    return [{
      id: now,
      x: (window.outerWidth - initialWidth) / 2,
      y: (window.innerHeight - initialWidth) / 2,
      width: initialWidth,
      height: initialWidth,
      rotation: 0,
      isPinned: false,
      color: `hsl(192, 100.00%, 99.00%)`,
      castShadow: true,
      text: "",
      pageNumber: 0,
      markdownFile: initialMarkdowns[0], // Store which markdown file this rectangle should load
      margins: {
        top: isMobile ? 16 : 6,
        right: isMobile ? 16 : 8,
        bottom: isMobile ? 16 : 8,
        left: isMobile ? 16 : 8
      }
    },
    // {
    //   id: now + 1,
    //   x: (window.outerWidth - initialWidth) / 2 - 50,
    //   y: (window.innerHeight - initialHeight) / 2,
    //   width: initialWidth,
    //   height: initialHeight,
    //   rotation: 0,
    //   isPinned: false,
    //   color: `hsl(192, 100.00%, 99.00%)`,
    //   castShadow: true,
    //   text: "",
    //   pageNumber: 1,
    //   markdownFile: initialMarkdowns[1], // Store which markdown file this rectangle should load
    //   margins: {
    //     top: isMobile ? 16 : 6,
    //     right: isMobile ? 16 : 8,
    //     bottom: isMobile ? 16 : 8,
    //     left: isMobile ? 16 : 8
    //   }
    // },
    // {
    //   id: now + 2,
    //   x: (window.outerWidth - initialWidth) / 2 + 50,
    //   y: (window.innerHeight - initialHeight) / 2,
    //   width: initialWidth,
    //   height: initialHeight,
    //   rotation: 0,
    //   isPinned: false,
    //   color: `hsl(192, 100.00%, 99.00%)`,
    //   castShadow: true,
    //   text: "",
    //   pageNumber: 2,
    //   markdownFile: initialMarkdowns[2], // Store which markdown file this rectangle should load
    //   margins: {
    //     top: isMobile ? 16 : 6,
    //     right: isMobile ? 16 : 8,
    //     bottom: isMobile ? 16 : 8,
    //     left: isMobile ? 16 : 8
    //   }
    // }
  ];
  };
  
  // New function to load content for a specific markdown file
  const loadMarkdownContent = async (fileName) => {
    console.log(`Attempting to load markdown file: ${fileName}`);
    
    // Try all possible path combinations
    const possiblePaths = [
      `/content/${fileName}`,
      `content/${fileName}`,
      `/${fileName}`,
      fileName
    ];
  
    for (const path of possiblePaths) {
      console.log('Trying path:', path);
      try {
        const response = await fetch(path);
        if (response.ok) {
          const content = await response.text();
          console.log('Successfully loaded from:', path);
          return content;
        }
      } catch (e) {
        console.log('Failed to load from:', path);
      }
    }
    
    // If we reach here, we couldn't load the file
    console.error(`Failed to load ${fileName}`);
    return null;
  };
  
  useEffect(() => {
    const loadInitialContent = async () => {
      const hash = window.location.hash;
      // Remove the #/ prefix and get page name
      const pageName = hash.replace('#/', '') || 'landing';
      
      // Get our initial rectangles
      const initialRects = getInitialRectangles();
      
      // Create a copy of the current rectangles
      let updatedRectangles = [...initialRects];
      
      // Load content for each rectangle
      const loadPromises = initialRects.map(async (rect, index) => {
        // Determine which markdown file to load
        // For rectangle 0, if there's a hash URL, use that instead of the default
        let mdFile = rect.markdownFile;
        if (index === 0 && hash) {
          mdFile = `${pageName}.md`;
        }
        
        let content = await loadMarkdownContent(mdFile);
        
        // If couldn't load specified file for rectangle 0, try landing.md
        if (content === null && index === 0) {
          console.log('Falling back to landing.md for main rectangle');
          content = await loadMarkdownContent('landing.md');
        }
        
        // Update the rectangle with the loaded content
        if (content !== null) {
          updatedRectangles[index] = {
            ...updatedRectangles[index],
            text: content
          };
        } else {
          // Set error message if content couldn't be loaded
          updatedRectangles[index] = {
            ...updatedRectangles[index],
            text: `# Error\nFailed to load ${mdFile}. Please check the console for details.`
          };
        }
      });
      
      // Wait for all content to be loaded
      await Promise.all(loadPromises);
      
      // Update state with the loaded rectangles
      setRectangles(updatedRectangles);
    };
    
    loadInitialContent();
    window.addEventListener('hashchange', loadInitialContent);
    return () => window.removeEventListener('hashchange', loadInitialContent);
  }, []);
  

const [rectangles, setRectangles] = useState(getInitialRectangles());
useEffect(() => {
  setSelectionOrder(rectangles.map(rect => rect.id));
}, []);

  // Structures
  const InteractiveArea = ({
    x,
    y,
    size = 40,
    cursor,
    onMouseDown,
    onTouchStart,
    onMouseEnter,
    onMouseLeave,
    onTouchEnter,
    onTouchLeave,
    children
  }) => {
    const touchSize = isMobile ? size : size; // Increase touch target size on mobile
    const [isTouch, setIsTouch] = useState(false);
    const [isActive, setIsActive] = useState(false);

    useEffect(() => {
      setIsTouch(isMobile);
    }, [isMobile]);

    const handleTouchStart = (e) => {
      e.stopPropagation();
      setIsActive(true);
      onTouchStart?.(e);
      onTouchEnter?.(e); // Simulate hover on touch start
      
      // Add visual feedback for touch
      const target = e.currentTarget;
      if (target) {
        target.style.opacity = "0.7";
        setTimeout(() => {
          if (target) target.style.opacity = "1";
        }, 150);
      }
    };

    const handleTouchEnd = () => {
      setIsActive(false);
      onTouchLeave?.(); // Simulate hover end on touch end
    };

    return (
      <div
        className="absolute"
        style={{
          transform: 'translate(-50%, -50%)',
          left: `${x}px`,
          top: `${y}px`,
          width: `${touchSize}px`,
          height: `${touchSize}px`,
          cursor,
          zIndex: 30,
          touchAction: 'none',
          background: isActive ? 'rgba(0, 0, 0, 0.1)' : 'rgba(0, 0, 0, 0.001)',
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'background 0.2s ease'
        }}
        onMouseDown={(e) => {
          e.stopPropagation();
          onMouseDown?.(e);
        }}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      >
        {children}
        {isTouch && (
          <div
            className="absolute inset-0 opacity-0 hover:opacity-10 transition-opacity"
            style={{
              background: 'currentColor',
              borderRadius: '50%'
            }}
          />
        )}
      </div>
    );
  };

  const RectangleContent = React.memo(({ rect, scrollPositions, setRectangles, setSelectedId, setSelectionOrder, canvasRotation }) => {
    const contentRef = useRef(null);    

    const handleScroll = useCallback((e) => {
      scrollPositions.current[rect.id] = e.target.scrollTop;
      // When content is being scrolled, prevent other interactions
      setIsScrollingRectangle(true);
      
      // Clear scrolling state after scrolling stops
      clearTimeout(window.scrollTimer);
      window.scrollTimer = setTimeout(() => {
        setIsScrollingRectangle(false);
      }, 100);
    }, [rect.id, scrollPositions]);
  
    
    useLayoutEffect(() => {
      const element = contentRef.current;
      if (element) {
        const savedPosition = scrollPositions.current[rect.id];
        if (savedPosition !== undefined) {
          element.scrollTop = savedPosition;
        }
      }
    }, [rect.id]);
  
    // Parse function parameters from a query string format
    const parseParams = (paramString) => {
      if (!paramString) return {};
      return Object.fromEntries(
        paramString.split('&').map(param => {
          const [key, value] = param.split('=');
          return [key, decodeURIComponent(value)];
        })
      );
    };
  
  // Calculate position based on parameters and current rectangle
    const calculatePosition = (params, currentRect) => {
      let x, y;
      
      if (params.relative === 'true' && currentRect) {
        // Get the offsets and directions
        const offset_x = parseFloat(params.x) || 0;
        const offset_y = parseFloat(params.y) || 0;
        const horizontal = params.horizontal || 'right';
        const vertical = params.vertical || 'bottom';
        
        // Calculate base positions based on edges
        if (horizontal === 'left') {
          x = currentRect.x - offset_x;
        } else if (horizontal === 'right') {
          x = currentRect.x + currentRect.width + offset_x;
        } else {
          x = currentRect.x + (currentRect.width / 2); // Center if not specified
        }
        
        if (vertical === 'top') {
          y = currentRect.y - offset_y;
        } else if (vertical === 'bottom') {
          y = currentRect.y + currentRect.height + offset_y;
        } else {
          y = currentRect.y + (currentRect.height / 2); // Center if not specified
        }
        
        // Convert canvas rotation to radians
        const rotationRad = (-canvasRotation * Math.PI) / 180;
        
        // Get the center of the current rectangle
        const centerX = currentRect.x + currentRect.width / 2;
        const centerY = currentRect.y + currentRect.height / 2;
        
        // Calculate position relative to center
        const relX = x - centerX;
        const relY = y - centerY;
        
        // Apply rotation transformation
        const rotatedX = relX * Math.cos(rotationRad) - relY * Math.sin(rotationRad);
        const rotatedY = relX * Math.sin(rotationRad) + relY * Math.cos(rotationRad);
        
        // Add rotated offsets back to center
        x = centerX + rotatedX;
        y = centerY + rotatedY;
      } else {
        // Absolute positioning
        x = parseFloat(params.x) || Math.random() * (window.innerWidth * 0.75);
        y = parseFloat(params.y) || Math.random() * (window.innerHeight * 0.75);
      }
      
      // Add jitter if not disabled
      if (params.jitter !== 'false') {
        let jitterAmount = params.jitterAmount || 50;
        x += Math.random() * jitterAmount - (jitterAmount/2);
        y += Math.random() * jitterAmount - (jitterAmount/2);
      }
      
      return { x, y };
    };
  
  
  const createRectangle = async (params, currentRect, content = null) => {
    const position = calculatePosition(params, currentRect);
    let text = "";

    if (content && content.url) {
      text = `<iframe src="${content.url}" style="width:100%; height:100%; border:none;"></iframe>`;
    } else if (content && content.file) {
      try {
        const response = await fetch(`/content/${content.file}`);
        text = await response.text();
      } catch (error) {
        console.error(`Error reading file ${content.file}:`, error);
      }
    }

    // Get the highest page number from existing rectangles and increment
    const highestPageNumber = Math.max(...rectangles.map(r => r.pageNumber), -1);
    const nextPageNumber = highestPageNumber + 1;

    // Default color
    let color = `hsl(192, 100.00%, 99.00%)`;
    
    // Check for RGB parameters
    if (params.colorR !== undefined && params.colorG !== undefined && params.colorB !== undefined) {
      // Parse the RGB values (ensuring they're within 0-255 range)
      const r = Math.min(255, Math.max(0, parseInt(params.colorR) || 0));
      const g = Math.min(255, Math.max(0, parseInt(params.colorG) || 0));
      const b = Math.min(255, Math.max(0, parseInt(params.colorB) || 0));
      
      // Create RGB color string
      color = `rgb(${r}, ${g}, ${b})`;
    }
    // Check for HSL parameters
    else if (params.colorH !== undefined && params.colorS !== undefined && params.colorL !== undefined) {
      // Parse the HSL values
      // Hue is a degree on the color wheel (0 to 360)
      const h = parseInt(params.colorH) % 360;
      // Saturation and Lightness are percentages (0 to 100)
      const s = Math.min(100, Math.max(0, parseInt(params.colorS) || 0));
      const l = Math.min(100, Math.max(0, parseInt(params.colorL) || 0));
      
      // Create HSL color string
      color = `hsl(${h}, ${s}%, ${l}%)`;
    }
    
    const castShadow = params.castShadow !== 'false';
    
    const defaultMargins = isMobile ? 
      { top: 16, right: 16, bottom: 16, left: 16 } : 
      { top: 6, right: 8, bottom: 8, left: 8 };

    const newRect = {
      id: Date.now(),
      x: position.x,
      y: position.y,
      width: parseFloat(params.width) || 300,
      height: parseFloat(params.height) || 200,
      rotation: parseFloat(params.rotation) || -canvasRotation,
      color: color,
      castShadow: castShadow,
      text,
      pageNumber: nextPageNumber,
      margins: {
        top: parseFloat(params.marginTop) || defaultMargins.top,
        right: parseFloat(params.marginRight) || defaultMargins.right,
        bottom: parseFloat(params.marginBottom) || defaultMargins.bottom,
        left: parseFloat(params.marginLeft) || defaultMargins.left
      }
    };

    setRectangles(prev => [...prev, newRect]);
    setSelectedId(newRect.id);
    setSelectionOrder(prev => [newRect.id, ...prev]);
  };

  // Available functions that can be called from markdown
  const availableFunctions = {
    addRectangle: async (paramString) => {
      const params = parseParams(paramString);
      await createRectangle(params, rect, { file: params.file });
    }
  };
  
// Update the renderContent function with text size support
const renderContent = useCallback((text) => {
  // Check if the text contains an iframe
  const iframeMatch = text.match(/<iframe.*?src="(.*?)".*?>/);

  if (iframeMatch) {
    return (
      <div className="absolute inset-0 flex flex-col">
        <div className="p-2 bg-gray-100 flex items-center justify-between">
          <div className="cursor-pointer text-blue-600 hover:underline">
          </div>
        </div>
        <iframe
          src={iframeMatch[1]}
          className="flex-grow border-none"
          style={{ width: '100%', height: 'calc(100% - 40px)' }}
          sandbox="allow-scripts allow-same-origin allow-forms"
        />
      </div>
    );
  }

  // Pre-process text size tags
  // Format: <size:VALUE>text</size>
  // Example: <size:24>Large Text</size> or <size:0.8em>Smaller text</size>
  const processTextWithSizes = (text) => {
    // Regex to match size tags with any valid CSS size value (px, em, rem, %)
    const sizeTagRegex = /<size:([\d.]+(?:px|em|rem|%|))>(.*?)<\/size>/gs;
    
    return text.replace(sizeTagRegex, (match, size, content) => {
      // If size doesn't have a unit, assume pixels
      const sizeValue = size.match(/\d/) ? (size.match(/[a-z%]+$/) ? size : `${size}px`) : size;
      return `<span style="font-size:${sizeValue}">${content}</span>`;
    });
  };

  // Process text with size tags before handling other markdown elements
  const processedText = processTextWithSizes(text);

  // Pre-process the text to find and mark special elements
  const customElements = new Map();
  let elementCounter = 0;

  // Replace function calls and links with unique placeholders
  const finalProcessedText = processedText.replace(
    /\[(.*?)\]\((function:\w+(?:\?[^)]+)?|https?:\/\/[^?]+(?:\?rect=[^)]+)?)\)/g,
    (match, linkText, target) => {
      const placeholder = `CUSTOM_ELEMENT_${elementCounter++}`;
      
      if (target.startsWith('function:')) {
        const [, functionName, params] = target.match(/function:(\w+)(?:\?(.+))?/);
        const functionToCall = availableFunctions[functionName];
        
        if (functionToCall) {
          customElements.set(placeholder, {
            type: 'function',
            content: linkText,
            onClick: (e) => {
              e.preventDefault();
              e.stopPropagation();
              functionToCall(params);
            }
          });
        }
      } else {
        const [, url, rectParams] = target.match(/(https?:\/\/[^?]+)(?:\?rect=(.+))?/);
        customElements.set(placeholder, {
          type: 'link',
          content: linkText,
          onClick: async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const params = rectParams ? parseParams(rectParams) : {};
            await createRectangle(params, rect, { url });
          }
        });
      }

      return placeholder;
    }
  );

  const markdownComponents = {
    // Handle div elements, preserving className and other attributes
    div: ({ node, className, children, ...props }) => {
  if (className) {
    const styles = {};
    
    // Apply styles based on className
    if (className.includes('text-center')) {
      styles.textAlign = 'center';
    }
    
    if (className.includes('text-vcenter')) {
      styles.position = 'absolute';
      styles.top = '50%';
      styles.left = '0';
      styles.right = '0';
      styles.transform = 'translateY(-50%)';
    }
    
    if (className.includes('text-center-all')) {
      styles.position = 'absolute';
      styles.top = '50%';
      styles.left = '0';
      styles.right = '0';
      styles.transform = 'translateY(-50%)';
      styles.textAlign = 'center';
    }
    
    return (
      <div className={className} style={styles} {...props}>
        {children}
      </div>
    );
  }
  
  return <div className={className} {...props}>{children}</div>;
},
    
    // Headers with proper styling - adjusted for better mobile visibility
    h1: ({ node, children }) => (
      <h1 className={`mt-6 mb-4 ${isMobile ? 'text-3xl' : 'text-4xl'} font-bold`}>{children}</h1>
    ),
    h2: ({ node, children }) => (
      <h2 className={`mt-5 mb-3 ${isMobile ? 'text-2xl' : 'text-3xl'} font-bold`}>{children}</h2>
    ),
    h3: ({ node, children }) => (
      <h3 className={`mt-4 mb-2 ${isMobile ? 'text-xl' : 'text-2xl'} font-bold`}>{children}</h3>
    ),
    
    // Support HTML in markdown, including spans with style attributes
    span: ({ node, ...props }) => {
      if (props.style) {
        return <span {...props} />;
      }
      return <span {...props} />;
    },
    
    // Lists with proper alignment and nesting
    ul: ({ node, children }) => (
      <ul className="list-disc pl-6 my-3 text-left block w-full">{children}</ul>
    ),
    ol: ({ node, children }) => (
      <ol className="list-decimal pl-6 my-3 text-left block w-full">{children}</ol>
    ),
    li: ({ node, children }) => {
      const hasNestedList = React.Children.toArray(children).some(
        child => React.isValidElement(child) && (child.type === 'ul' || child.type === 'ol')
      );
      return (
        <li className={`my-1 ${hasNestedList ? 'block' : ''}`}>{children}</li>
      );
    },
    p: ({ children }) => {
      // Process children to replace placeholders with custom elements
      const processedChildren = React.Children.map(children, child => {
        if (typeof child === 'string') {
          const segments = child.split(/(\bCUSTOM_ELEMENT_\d+\b)/);
          return segments.map((segment, index) => {
            if (customElements.has(segment)) {
              const element = customElements.get(segment);
              return (
                <span
                  key={index}
                  onClick={element.onClick}
                  className={`cursor-pointer inline ${element.type === 'link' ? 'text-blue-600 hover:underline' : ''}`}
                  style={{ fontFamily: font, display: 'inline' }}
                >
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm, remarkMath]}
                    rehypePlugins={[rehypeRaw, rehypeKatex]}
                    components={{
                      ...markdownComponents,
                      p: ({ children }) => <>{children}</>,
                    }}
                  >
                    {element.content}
                  </ReactMarkdown>
                </span>
              );
            }
            return segment;
          });
        }
        return child;
      });

      const allInline = processedChildren.every(child => 
        typeof child === 'string' || 
        (React.isValidElement(child) && (
          child.type === 'span' ||
          child.props?.className?.includes('inline')
        ))
      );

      return allInline ? <>{processedChildren}</> : <p>{processedChildren}</p>;
    }
  };

  return (
    <div style={{ fontFamily: font }} className="markdown-wrapper">
      <style>
        {`
          /* Enhanced styles for better mobile reading */
          .markdown-wrapper {
            font-size: ${isMobile ? '16px' : '14px'};
            line-height: ${isMobile ? '1.6' : '1.5'};
          }
          
          /* Improved touch targets for mobile */
          .markdown-wrapper a, 
          .markdown-wrapper button,
          .markdown-wrapper [role="button"] {
            padding: ${isMobile ? '8px 4px' : '4px 2px'};
            min-height: ${isMobile ? '44px' : 'auto'};
            display: inline-flex;
            align-items: center;
          }
          
          /* Better spacing for mobile content */
          .markdown-wrapper p {
            margin-bottom: ${isMobile ? '16px' : '12px'};
          }
        `}
      </style>
      <ReactMarkdown 
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeRaw, rehypeKatex]}
        components={markdownComponents}
      >
        {finalProcessedText}
      </ReactMarkdown>
    </div>
  );
}, [rect, availableFunctions, font, isMobile]);
  
    const parseContentWithMargins = useCallback((text) => {
      const margins = rect.margins || {
        top: isMobile ? 16 : 20,
        right: isMobile ? 16 : 20,
        bottom: isMobile ? 16 : 20,
        left: isMobile ? 16 : 20
      };
    
      const lines = text.split('\n');
      
    const marginContents = {
      left: [],
      'left-normal': [],
      right: [],
      'right-normal': [],
      top: [],
      bottom: []
    };

    let lineIndex = 0;
    const mainContentLines = [];

    while (lineIndex < lines.length) {
      const line = lines[lineIndex];
      
      const marginMatch = line.match(/%{margin-(left|right|top|bottom)(-normal)?-start(\s+vertical=(-?\d+(?:\.\d+)?(?:px|%)|\d+(?:\.\d+)?(?:px|%)))?(\s+horizontal=(-?\d+(?:\.\d+)?(?:px|%)|\d+(?:\.\d+)?(?:px|%)))?}/);

      
      if (marginMatch) {
        const position = marginMatch[1];
        const normalFlag = marginMatch[2];
        const verticalPosition = marginMatch[4] || '0px';    // Extract from regex group 4
        const horizontalPosition = marginMatch[6] || '0px';  // Extract from regex group 6
        const key = normalFlag ? `${position}-normal` : position;
        
        let marginContent = [];
        let currentLine = lineIndex + 1;
        
        while (currentLine < lines.length && !lines[currentLine].includes(`%{margin-${position}${normalFlag || ''}-end}`)) {
          marginContent.push(lines[currentLine]);
          currentLine++;
        }
        
        marginContents[key].push({
          content: marginContent.join('\n').trim(),
          vertical: verticalPosition,
          horizontal: horizontalPosition
        });
        
        lineIndex = currentLine + 1;
      } else {
        mainContentLines.push(line);
        lineIndex++;
      }
    }

      const mainContent = mainContentLines.join('\n').trim();
    
      // Adjust margin sizes for better usability on mobile
      const minMarginSize = isMobile ? 36 : 28;
      const marginSizes = {
        left:   Math.max(rect.width  * (margins.left   / 100), minMarginSize),
        right:  Math.max(rect.width  * (margins.right  / 100), minMarginSize),
        top:    Math.max(rect.height * (margins.top    / 100), minMarginSize),
        bottom: Math.max(rect.height * (margins.bottom / 100), minMarginSize)
      };

      const mainContentElement = (
        <div 
          ref={contentRef}
          onScroll={handleScroll}
          className="content-scrollable"
          style={{ 
            position: 'absolute',
            top: `${marginSizes.top}px`,
            left: `${marginSizes.left}px`,
            right: `${marginSizes.right}px`,
            bottom: `${marginSizes.bottom}px`,
            overflow: 'auto',
            WebkitOverflowScrolling: 'touch', // Smoother scrolling on iOS
            msOverflowStyle: 'none', // Hide scrollbars on IE/Edge
            scrollbarWidth: 'thin', // Thin scrollbars on Firefox
            padding: isMobile ? '8px' : '4px',
            touchAction: 'pan-y', // Enable vertical scrolling for touch
            overscrollBehavior: 'contain' // Prevent scroll chaining
          }}
          onTouchStart={(e) => {
            // Mark this rectangle as having the active scroll
            activeRectangleRef.current = rect.id;
            // Don't prevent default so native scrolling works
            e.stopPropagation();  // Stop event from bubbling to parent handlers
          }}
        >
          {renderContent(mainContent)}
        </div>
      );

// Update the marginElements section in parseContentWithMargins
const marginElements = Object.entries(marginContents).map(([positionKey, contents]) => 
  contents.map((content, idx) => {
    const [position, orientation] = positionKey.split('-');
    const isNormal = orientation === 'normal';
    const isSideMargin = position === 'left' || position === 'right';
    
    const parsePosition = (pos) => {
      if (typeof pos !== 'string') return { value: 0, unit: 'px' };
      const match = pos.match(/^(-?\d*\.?\d+)(px|%)$/);
      if (!match) return { value: 0, unit: 'px' };
      return {
        value: parseFloat(match[1]),
        unit: match[2]
      };
    };
    
    const verticalPos = parsePosition(content.vertical);
    const horizontalPos = parsePosition(content.horizontal);
    
    const verticalOffset = verticalPos.unit === '%' 
      ? `${verticalPos.value}%` 
      : `${verticalPos.value}px`;
      
    const horizontalOffset = horizontalPos.unit === '%' 
      ? `${horizontalPos.value}%` 
      : `${horizontalPos.value}px`;
    
    const style = {
      position: 'absolute',
      margin: 0,
      zIndex: 10,
      overflow: 'hidden',
      boxSizing: 'border-box',
      // Increase touch area for mobile
      padding: isMobile && isSideMargin ? '8px 4px' : '0'
    };

    const wrapperStyle = {
      width: '100%',
      height: isSideMargin ? '100%' : '100%',
      fontFamily: font,
      fontSize: fontSize,
      display: 'flex',
      alignItems: isSideMargin ? 'flex-start' : 'center',
      justifyContent: isSideMargin ? 'flex-start' : 'center',
      position: 'relative',
      overflow: 'hidden'
    };

    const contentStyle = {
      transform: 
        !isNormal && position === 'left' ? 'rotate(-90deg) translate(30%, 50%)' : 
        !isNormal && position === 'right' ? 'rotate(90deg) translate(-30%, 50%)' : 
        'none',
      transformOrigin: !isNormal && position === 'left' ? 
        'left bottom' :
        !isNormal && position === 'right' ?
        'right bottom' :
        'top left',
      width: isSideMargin && !isNormal ? 'max-content' : '100%',
      maxWidth: isSideMargin && !isNormal ? 
        `${rect.height - margins.top - margins.bottom - 32}px` : 
        '100%',
      position: 'absolute',
      overflowWrap: 'break-word',
      // Adjust font size for better readability on mobile
      fontSize: isMobile ? `${fontSize * 1.1}px` : `${fontSize}px`,
      ...(isSideMargin && !isNormal && {
        position: 'absolute',
        left: position === 'left' ? '50%' : undefined,
        right: position === 'right' ? '50%' : undefined,
        top: '50%'
      })
    };

    switch(position) {
      case 'left':
        style.left = horizontalOffset;
        style.width = `${marginSizes.left}px`;
        style.top = verticalOffset;
        style.height = `${rect.height - marginSizes.top - marginSizes.bottom - 32}px`;
        style.overflow = 'hidden';
        // Increase touch area for mobile
        if (isMobile) {
          style.minWidth = '40px';
        }
        break;
      case 'right':
        style.right = horizontalOffset;
        style.width = `${marginSizes.right}px`;
        style.top = verticalOffset;
        style.height = `${rect.height - marginSizes.top - marginSizes.bottom - 32}px`;
        style.overflow = 'hidden';
        // Increase touch area for mobile
        if (isMobile) {
          style.minWidth = '40px';
        }
        break;
      case 'top':
        style.position = 'absolute';
        style.top = verticalOffset;
        style.height = `${marginSizes.top}px`;
        style.width = `${rect.width - marginSizes.left - marginSizes.right - 32}px`;
        style.overflow = 'visible';
        // Improve tap target size on mobile
        if (isMobile) {
          style.minHeight = '40px';
        }
        if (content.horizontal === '0px' || !content.horizontal) {
          style.left = '50%';
          style.transform = 'translateX(-50%)';
        } else {
          style.left = horizontalOffset;
        }
        break;
      case 'bottom':
        const baseBottomOffset = isMobile ? 6 : 4;
        const calculatedBottom = parseFloat(verticalOffset) || 0;
        style.position = 'absolute';
        style.bottom = `${calculatedBottom - baseBottomOffset}px`;
        style.height = `${marginSizes.bottom}px`;
        style.width = `${rect.width - marginSizes.left - marginSizes.right - 32}px`;
        style.overflow = 'visible';
        style.maxHeight = isMobile ? '40px' : '32px';
        // Improve tap target size on mobile
        if (isMobile) {
          style.minHeight = '40px';
        }
        if (content.horizontal === '0px' || !content.horizontal) {
          style.left = '50%';
          style.transform = 'translateX(-50%)';
        } else {
          style.left = horizontalOffset;
        }
        break;
    }

    return (
      <div
        key={`margin-${positionKey}-${idx}`}
        style={style}
        className="rect-margin-element"
      >
        <div style={wrapperStyle}>
          <div 
            style={contentStyle}
            className="markdown-content"
          >
            {renderContent(content.content)}
          </div>
        </div>
      </div>
    );
  })
).flat();
    
      return [
        mainContentElement,
        ...marginElements.map((element, index) => (
          <React.Fragment key={`margin-${index}`}>{element}</React.Fragment>
        ))
      ];
    }, [rect, renderContent, isMobile]);

    const pageNumberDisplay = (
      <div
        style={{
          position: 'absolute',
          bottom: isMobile ? '8px' : '4px',
          left: isMobile ? '12px' : '9px',
          fontSize: isMobile ? 14 : 12,
          fontFamily: font,
          color: 'black',
          zIndex: 20,
          pointerEvents: 'none'
        }}
      >
        {(hoveredCorner.id === rect.id && hoveredCorner.corner === 'bottomleft') ? 
          String("") : 
          String(rect.pageNumber).padStart(2, '0')}
      </div>
    );
  
    return (
      <div
        className="absolute inset-0 overflow-auto select-text rectangle-content"
        onClick={(e) => e.stopPropagation()}
        style={{ 
          cursor: 'text',
          WebkitTapHighlightColor: 'transparent' // Remove tap highlight on mobile
        }}
        onTouchStart={(e) => {
          // Track the rectangle that is being interacted with
          activeRectangleRef.current = rect.id;
        }}
      >
          <div 
            className={`prose ${isMobile ? 'prose-base' : 'prose-sm'} max-w-none h-full`}
            style={{
              padding: rect.margins ? 
                `${rect.height * (rect.margins.top / 100)}px 
                ${rect.width * (rect.margins.right / 100)}px 
                ${rect.height * (rect.margins.bottom / 100)}px 
                ${rect.width * (rect.margins.left / 100)}px` 
                : '16px'
            }}
          >
            {parseContentWithMargins(rect.text).map((element, index) => (
              <React.Fragment key={`content-${rect.id}-${index}`}>
                {element}
              </React.Fragment>
            ))}
          </div>
        {pageNumberDisplay}
      </div>
    );
  });

// TopFlap component with roll-out animation
const TopFlap = React.memo(({ rect, isSelected }) => {
  const isHovered = hoveredFlap === rect.id;
  const flapHeight = isMobile ? 60 : 50;
  const flapWidth = isMobile ? 160 : 140;
  const verticalOffset = isMobile ? -26 : -22;
  
  return (
    <div
      className={`
        flap-content 
        absolute 
        overflow-hidden
      `}
      style={{
        top: `-${verticalOffset + flapHeight}px`,
        left: '50%',
        transform: `translateX(-50%) perspective(1000px)`,
        width: `${flapWidth}px`,
        height: `${flapHeight}px`,
        zIndex: getZIndex(rect.id),
        opacity: isHovered ? 1 : 0,
      }}
      onMouseEnter={() => setHoveredFlap(rect.id)}
      onMouseLeave={(e) => {
        const relatedTarget = e.relatedTarget;
        if (!relatedTarget?.closest('.flap-hover-area')) {
          setHoveredFlap(null);
        }
      }}
      onTouchStart={() => setHoveredFlap(rect.id)}
    >
      <div 
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          transform: isHovered ? 'rotateX(0deg)' : 'rotateX(-90deg)',
          transformOrigin: 'bottom',
          backfaceVisibility: 'hidden',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundColor: rect.color, // Use the rectangle's color instead of a fixed color
            boxShadow: isHovered 
              ? '0 4px 6px rgba(0, 0, 0, 0.2)' 
              : '0 2px 4px rgba(0, 0, 0, 0.2)',
          }}
        >
          <div className="absolute inset-0 flex justify-center items-center gap-6">
            {[
              {
                key: 'pin',
                icon: rect.isPinned ? <PinOff size={isMobile ? 24 : 20} /> : <Pin size={isMobile ? 24 : 20} />,
                onClick: (e) => {
                  e.stopPropagation();
                  handlePin(rect.id);
                },
                style: {
                  color: rect.isPinned ? '#2563eb' : '#6b7280'
                },
                className: `
                  ${isMobile ? 'p-3' : 'p-2'}
                  rounded 
                  hover:bg-gray-100 
                  active:bg-gray-200
                  ${isHovered ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2'}
                `
              },
              {
                key: 'delete',
                icon: <Trash2 size={isMobile ? 24 : 20} />,
                onClick: (e) => {
                  e.stopPropagation();
                  handleDelete(rect.id);
                },
                className: `
                  ${isMobile ? 'p-3' : 'p-2'}
                  rounded 
                  hover:bg-gray-100 
                  active:bg-gray-200
                  text-gray-500 
                  hover:text-red-500
                  ${isHovered ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2'}
                `
              }
            ].map((control, index) => (
              <button
                key={`${control.key}-${rect.id}`}
                className={control.className}
                onClick={control.onClick}
                style={{
                  ...control.style,
                  transitionDelay: `${150 + index * 50}ms`
                }}
              >
                {control.icon}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
});

// FlapHoverArea component with adjusted hover area
const FlapHoverArea = ({ rect, isSelected }) => {
  const areaHeight = isMobile ? 60 : 50;
  const areaWidth = isMobile ? 180 : 160;
  const verticalOffset = isMobile ? 36 : 30;

  return (
    <div
      className="absolute flap-hover-area"
      style={{
        top: `-${verticalOffset}px`,
        left: '50%',
        transform: 'translateX(-50%)',
        width: `${areaWidth}px`,
        height: `${areaHeight}px`,
        pointerEvents: 'auto',
        cursor: 'pointer',
      }}
      onMouseEnter={() => setHoveredFlap(rect.id)}
      onMouseLeave={(e) => {
        const relatedTarget = e.relatedTarget;
        const flapContent = relatedTarget?.closest('.flap-content');
        if (!flapContent) {
          setHoveredFlap(null);
        }
      }}
      onTouchStart={() => setHoveredFlap(rect.id)}
    />
  );
};

const getZIndex = (rectId) => {
  const rect = rectangles.find(r => r.id === rectId);
  if (rect && pinnedRectangles.has(rectId)) {
    return 1000; // Pinned rectangles always on top
  }
  
  // Selected rectangles should be on top
  if (selectedId === rectId) {
    return 900;
  }
  
  const index = selectionOrder.indexOf(rectId);
  return selectionOrder.length - index;
};

const hslToRgb = (h, s, l) => {
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1/6) return p + (q - p) * 6 * t;
    if (t < 1/2) return q;
    if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
    return p;
  };

  s /= 100;
  l /= 100;
  h /= 360;

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;

  return {
    r: Math.round(hue2rgb(p, q, h + 1/3) * 255),
    g: Math.round(hue2rgb(p, q, h) * 255),
    b: Math.round(hue2rgb(p, q, h - 1/3) * 255)
  };
};

const interpolateColor = (color1, factor) => {
  // Background color (Tailwind gray-100)
  const bgColor = {
    r: 243,
    g: 244,
    b: 246
  };

  // Parse the original color
  let rgbColor;
  
  // Check if it's an RGB format: rgb(r, g, b)
  const rgbMatch = color1.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (rgbMatch) {
    rgbColor = {
      r: parseInt(rgbMatch[1]),
      g: parseInt(rgbMatch[2]),
      b: parseInt(rgbMatch[3])
    };
  } 
  // Check if it's an HSL format: hsl(h, s%, l%)
  else {
    const hslMatch = color1.match(/hsl\((\d+),\s*([\d.]+)%,\s*([\d.]+)%\)/);
    if (hslMatch) {
      rgbColor = hslToRgb(
        parseInt(hslMatch[1]),
        parseFloat(hslMatch[2]),
        parseFloat(hslMatch[3])
      );
    }
  }

  // If no valid color format was found, return the original
  if (!rgbColor) return color1;

  // Interpolate between the colors
  const r = Math.round(rgbColor.r + (bgColor.r - rgbColor.r) * factor);
  const g = Math.round(rgbColor.g + (bgColor.g - rgbColor.g) * factor);
  const b = Math.round(rgbColor.b + (bgColor.b - rgbColor.b) * factor);

  return `rgb(${r}, ${g}, ${b})`;
};

const getInterpolatedColor = (rectId) => {
  const rect = rectangles.find(r => r.id === rectId);
  if (!rect) return rect.color;

  if (pinnedRectangles.has(rectId)) {
    return rect.color; // Pinned rectangles keep their original color
  }

  const index = selectionOrder.indexOf(rectId);
  if (index === -1 || index === 0) return rect.color; // Selected rectangle keeps original color

  // Always interpolate over 8 steps, with a more gradual fall-off
  const maxSteps = 8;
  
  // If beyond 8 steps, use constant interpolation
  if (index >= maxSteps) {
    const smoothFactor = 1 - Math.pow(1 - 1, 2); // Fully interpolated
    return interpolateColor(rect.color, smoothFactor);
  }

  // Use a less aggressive power function to create more gradual fall-off
  const interpolationFactor = Math.min(index / (maxSteps - 1), 1);
  const smoothFactor = 1 - Math.pow(1 - interpolationFactor, 2);
  
  return interpolateColor(rect.color, smoothFactor);
};

const getInterpolatedDepth = (rectId) => {
  const rect = rectangles.find(r => r.id === rectId);
  if (!rect || !rect.castShadow) return "none";

  const index = selectionOrder.indexOf(rectId);
  if (index === -1 || index === 0) return "4px 4px 8px rgba(0, 0, 0, 0.2)"; // Selected rectangle keeps original shadow

  // Always interpolate over 8 steps, with a more gradual fall-off
  const maxSteps = 8;
  
  // If beyond 8 steps, use constant interpolation
  if (index >= maxSteps) {
    return "4px 4px 8px rgba(0, 0, 0, 0.01)";
  }

  // Interpolate from 0.2 to 0.01 across 8 steps with more gradual fall-off
  const startIntensity = 0.2;
  const endIntensity = 0.01;
  
  // Use a less aggressive power function to create more gradual fall-off
  const interpolationFactor = Math.min(index / (maxSteps - 1), 1);
  const smoothFactor = 1 - Math.pow(1 - interpolationFactor, 2);
  const shadowIntensity = startIntensity - (smoothFactor * (startIntensity - endIntensity));

  return `4px 4px 8px rgba(0, 0, 0, ${shadowIntensity})`;
};

  const handlePin = (rectId) => {
    setRectangles(prev => prev.map(rect => {
      if (rect.id === rectId) {
        const newIsPinned = !rect.isPinned;
        if (newIsPinned) {
          setPinnedRectangles(prev => new Set([...prev, rectId]));
        } else {
          setPinnedRectangles(prev => {
            const next = new Set(prev);
            next.delete(rectId);
            return next;
          });
        }
        return { ...rect, isPinned: newIsPinned };
      }
      return rect;
    }));
  };

  const handleDelete = (rectId) => {
    setRectangles(prev => {
      const updatedRectangles = prev.filter(rect => rect.id !== rectId);
      
      // If this deletion would leave us with no rectangles, restore all initial rectangles
      if (updatedRectangles.length === 0) {
        // Get the initial rectangles but don't set them yet
        const initialRects = getInitialRectangles();
        
        // Load content for each rectangle
        initialRects.forEach((rect, index) => {
          loadMarkdownContent(rect.markdownFile)
            .then(content => {
              if (content !== null) {
                setRectangles(prevRects => {
                  const newRects = [...prevRects];
                  // Make sure the rectangle still exists before updating it
                  if (index < newRects.length) {
                    newRects[index] = { ...newRects[index], text: content };
                    return newRects;
                  }
                  return prevRects;
                });
              }
            })
            .catch(error => {
              console.error(`Error loading ${rect.markdownFile}:`, error);
            });
        });
        
        // Set selection order for all initial rectangles
        setSelectionOrder(initialRects.map(rect => rect.id));
        return initialRects;
      }
      
      return updatedRectangles;
    });
  
    setPinnedRectangles(prev => {
      const next = new Set(prev);
      next.delete(rectId);
      return next;
    });
    
    if (selectedId === rectId) {
      setSelectedId(null);
    }
    
    setSelectionOrder(prev => prev.filter(id => id !== rectId));
  };

  const handleMouseEnter = useCallback((e, rectId) => {
    e.stopPropagation();
    if (selectedId !== rectId) {
      setSelectedId(rectId);
      // Update selection order by moving the selected rectangle to the front
      setSelectionOrder(prev => {
        const filtered = prev.filter(id => id !== rectId);
        return [rectId, ...filtered];
      });
    }
  }, [selectedId]);

  const handleMouseLeave = useCallback((e, rectId) => {
    e.stopPropagation();

    // Use requestAnimationFrame to handle asynchronous mouse movement more reliably
    requestAnimationFrame(() => {
      // Get the element under the current mouse cursor
      const underCursor = document.elementFromPoint(
        e.clientX,
        e.clientY
      );

      if (!underCursor) {
        setSelectedId(null);
        return;
      }

      // Find the closest rectangle container
      const newRectContainer = underCursor.closest('[data-rect-id]');
      
      // If we're not entering another rectangle, clear selection
      if (!newRectContainer) {
        setSelectedId(null);
        return;
      }

      // If we're entering a new rectangle, update selection to that rectangle's ID
      const newRectId = parseInt(newRectContainer.getAttribute('data-rect-id'));
      if (newRectId !== rectId) {
        setSelectedId(newRectId);
        setSelectionOrder(prev => {
          const filtered = prev.filter(id => id !== newRectId);
          return [newRectId, ...filtered];
        });
      }
    });
  }, []);

  const handleMouseDown = (e, id, actionType, corner) => {
    if (!canvasRef.current) return;

    e.preventDefault();
    e.stopPropagation();
    
    setSelectedOperation(actionType);

    // Track that we're using mouse interaction, not mobile
    isMobileInteraction.current = false;

    const rect = rectangles.find(r => r.id === id);
    if (!rect) return;

    const canvas = canvasRef.current.getBoundingClientRect();
    const mouseX = e.clientX - canvas.left;
    const mouseY = e.clientY - canvas.top;

    // Convert screen coordinates to canvas space
    const canvasCenter = {
      x: window.innerWidth / 2,
      y: window.innerHeight / 2
    };

    // First, transform mouse coordinates relative to canvas center
    const relativeToCenterX = mouseX - canvasCenter.x;
    const relativeToCenterY = mouseY - canvasCenter.y;

    // Apply inverse canvas rotation and scale
    const canvasRotationRad = (-canvasRotation * Math.PI) / 180;
    const rotatedX = (
      relativeToCenterX * Math.cos(canvasRotationRad) -
      relativeToCenterY * Math.sin(canvasRotationRad)
    );
    const rotatedY = (
      relativeToCenterX * Math.sin(canvasRotationRad) +
      relativeToCenterY * Math.cos(canvasRotationRad)
    );

    // Apply inverse viewport transform to get world coordinates
    const worldStartX = (rotatedX / viewport.scale) - (viewport.x / viewport.scale) + canvasCenter.x;
    const worldStartY = (rotatedY / viewport.scale) - (viewport.y / viewport.scale) + canvasCenter.y;

    setSelectedId(id);
    setAction({ type: actionType, corner });
    setStartPoint({ x: worldStartX, y: worldStartY });
    setrect({ ...rect });
    setLastAngle(rect.rotation);

    const handleMove = (moveEvent) => {
      const currentMouseX = moveEvent.clientX - canvas.left;
      const currentMouseY = moveEvent.clientY - canvas.top;

      // Convert current mouse position using same transformation as start point
      const relativeCurrentX = currentMouseX - canvasCenter.x;
      const relativeCurrentY = currentMouseY - canvasCenter.y;

      const rotatedCurrentX = (
        relativeCurrentX * Math.cos(canvasRotationRad) -
        relativeCurrentY * Math.sin(canvasRotationRad)
      );
      const rotatedCurrentY = (
        relativeCurrentX * Math.sin(canvasRotationRad) +
        relativeCurrentY * Math.cos(canvasRotationRad)
      );

      const worldCurrentX = (rotatedCurrentX / viewport.scale) - (viewport.x / viewport.scale) + canvasCenter.x;
      const worldCurrentY = (rotatedCurrentY / viewport.scale) - (viewport.y / viewport.scale) + canvasCenter.y;

      // Calculate world space delta
      const deltaX = worldCurrentX - worldStartX;
      const deltaY = worldCurrentY - worldStartY;

      setRectangles(prevRects =>
        prevRects.map(r => {
          if (r.id !== id) return r;

          if (actionType === 'move') {
            // For move action, we can directly apply the world-space delta
            // since our coordinate transformation already accounts for canvas rotation
            return {
              ...r,
              x: rect.x + deltaX,
              y: rect.y + deltaY
            };
          }

          if (actionType === 'rotate') {
            const center = {
              x: rect.x + rect.width / 2,
              y: rect.y + rect.height / 2
            };

            // Calculate angles in the canvas-rotated coordinate system
            const startAngle = Math.atan2(
              worldStartY - center.y,
              worldStartX - center.x
            );
            const currentAngle = Math.atan2(
              worldCurrentY - center.y,
              worldCurrentX - center.x
            );
            const deltaAngle = (currentAngle - startAngle) * (180 / Math.PI);

            return {
              ...r,
              rotation: (rect.rotation + deltaAngle) % 360
            };
          }

          if (actionType === 'resize') {
            // Get rectangle's center in world space
            const centerX = rect.x + rect.width / 2;
            const centerY = rect.y + rect.height / 2;

            // Convert world coordinates to rectangle's local space
            // First, undo the rectangle's rotation
            const rectAngleRad = (rect.rotation * Math.PI) / 180;
            const cos = Math.cos(-rectAngleRad);
            const sin = Math.sin(-rectAngleRad);

            // Transform current point to rectangle's local space
            const relativeMouseX = worldCurrentX - centerX;
            const relativeMouseY = worldCurrentY - centerY;
            const rectLocalCurrentX = relativeMouseX * cos - relativeMouseY * sin;
            const rectLocalCurrentY = relativeMouseX * sin + relativeMouseY * cos;

            // Transform start point to rectangle's local space
            const relativeStartX = worldStartX - centerX;
            const relativeStartY = worldStartY - centerY;
            const rectLocalStartX = relativeStartX * cos - relativeStartY * sin;
            const rectLocalStartY = relativeStartX * sin + relativeStartY * cos;

            // Calculate deltas in rectangle's local space
            const deltaLocalX = rectLocalCurrentX - rectLocalStartX;
            const deltaLocalY = rectLocalCurrentY - rectLocalStartY;

            // Initialize new dimensions
            let newWidth = rect.width;
            let newHeight = rect.height;
            let newX = rect.x;
            let newY = rect.y;

            // Scale factor to account for canvas rotation and scale
            const scaleFactor = 1;

            switch (corner) {
              case 'topleft':
                newWidth = rect.width - deltaLocalX * scaleFactor;
                newHeight = rect.height - deltaLocalY * scaleFactor;
                break;
              case 'topright':
                newWidth = rect.width + deltaLocalX * scaleFactor;
                newHeight = rect.height - deltaLocalY * scaleFactor;
                break;
              case 'bottomleft':
                newWidth = rect.width - deltaLocalX * scaleFactor;
                newHeight = rect.height + deltaLocalY * scaleFactor;
                break;
              case 'bottomright':
                newWidth = rect.width + deltaLocalX * scaleFactor;
                newHeight = rect.height + deltaLocalY * scaleFactor;
                break;
            }

            // Calculate the change in dimensions
            const deltaWidth = newWidth - rect.width;
            const deltaHeight = newHeight - rect.height;

            // Ensure minimum size
            newWidth = Math.max(50, newWidth);
            newHeight = Math.max(50, newHeight);

            // Adjust position to maintain the correct corner
            newX = centerX - newWidth / 2;
            newY = centerY - newHeight / 2;

            return {
              ...r,
              width: newWidth,
              height: newHeight,
              x: newX,
              y: newY
            };
          }

          return r;
        })
      );
    };

    const handleUp = () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
      setAction(null);
      setrect(null);
      setSelectedOperation(null);
    };

    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
  };

  const getTouchDistance = (touch1, touch2) => {
    const dx = touch1.clientX - touch2.clientX;
    const dy = touch1.clientY - touch2.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  // Function to calculate angle between two touch points
  const getTouchAngle = (touch1, touch2) => {
    return Math.atan2(
      touch2.clientY - touch1.clientY,
      touch2.clientX - touch1.clientX
    ) * 180 / Math.PI;
  };
  
  // Detect if a touch is a long press
  const detectLongPress = (startEvent, currentEvent, duration = 500) => {
    if (!startEvent || !currentEvent) return false;
    
    const startTouch = startEvent.touches[0];
    const currentTouch = currentEvent.touches[0];
    
    const elapsedTime = currentEvent.timeStamp - startEvent.timeStamp;
    
    // Check if touch has moved significantly (tolerating small movements)
    const dx = currentTouch.clientX - startTouch.clientX;
    const dy = currentTouch.clientY - startTouch.clientY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    // Allow small movement (10px) for long press to be valid
    return elapsedTime >= duration && distance < 10;
  };
  
  // Convert touch event to equivalent mouse event coordinates
  const touchToMouseEvent = (touch) => {
    return {
      clientX: touch.clientX,
      clientY: touch.clientY,
      preventDefault: () => {},
      stopPropagation: () => {}
    };
  };

  const handleTouchStart = useCallback((e) => {
    if (!canvasRef.current) return;
    
    // Set mobile interaction flag
    isMobileInteraction.current = true;
    
    // Record touch start time and position for gestures
    touchStartTime.current = e.timeStamp;
    if (e.touches.length === 1) {
      const touch = e.touches[0];
      touchStartPosition.current = { x: touch.clientX, y: touch.clientY };
    }

    // Check if we're touching inside a content area
    const contentArea = e.target.closest('.content-scrollable');
    if (contentArea) {
      // Let the content area handle scrolling
      setIsScrollingRectangle(true);
      return;
    }
    
    // If touching a rectangle directly but not in a scrollable area
    const rectElement = e.target.closest('[data-rect-id]');
    if (rectElement && !action) {
      const rectId = parseInt(rectElement.getAttribute('data-rect-id'));
      
      // Set up long press detection
      clearTimeout(longPressTimer.current);
      longPressTimer.current = setTimeout(() => {
        // If still touching same position, trigger selection
        setSelectedId(rectId);
        setSelectionOrder(prev => {
          const filtered = prev.filter(id => id !== rectId);
          return [rectId, ...filtered];
        });
        
        // Provide haptic feedback if available
        if (navigator.vibrate) {
          navigator.vibrate(50);
        }
      }, 300);
      
      return;
    }

    // Clear selection if touching the background directly
    if (e.target === canvasRef.current) {
      setSelectedId(null);
      e.preventDefault(); // Prevent default browser behavior for canvas
    }

    // If we're in the middle of a transformation, don't handle canvas interactions
    if (action !== null) {
      return;
    }

    const touches = Array.from(e.touches);

    // Update active touches
    const newTouches = new Map();
    touches.forEach(t => {
      newTouches.set(t.identifier, {
        clientX: t.clientX,
        clientY: t.clientY,
        timeStamp: e.timeStamp
      });
    });
    setActiveTouches(newTouches);
    setLastTouchInfo({
      touches: newTouches,
      timeStamp: e.timeStamp
    });

    if (touches.length === 2) {
      // Two-finger gesture for zoom and rotation
      e.preventDefault(); // Prevent default for multi-touch
      const distance = getTouchDistance(touches[0], touches[1]);
      const angle = getTouchAngle(touches[0], touches[1]);
      setInitialTouchDistance(distance);
      setInitialTouchAngle(angle);
      setInitialScale(viewport.scale);
      setInitialRotation(canvasRotation);
    } else if (touches.length === 1) {
      // Single-finger gesture for dragging
      lastMousePos.current = { x: touches[0].clientX, y: touches[0].clientY };
      
      // Delay setting dragging mode to detect if it's a tap or drag
      setTimeout(() => {
        if (activeTouches.size === 1 && !isScrollingRectangle) {
          setIsDraggingCanvas(true);
        }
      }, 50);
    }
  }, [viewport.scale, canvasRotation, action, activeTouches, isScrollingRectangle]);

  const handleTouchMove = useCallback((e) => {
    // Clear any pending long press when touch moves
    clearTimeout(longPressTimer.current);
    
    // Handle content scrolling
    const contentArea = e.target.closest('.content-scrollable');
    if (contentArea || isScrollingRectangle) {
      // Allow default scrolling behavior
      return;
    }
    
    e.preventDefault(); // Prevent default for other cases
    const touches = Array.from(e.touches);

    // Calculate touch movement from start
    if (touches.length === 1 && touchStartPosition.current) {
      const touch = touches[0];
      const dx = touch.clientX - touchStartPosition.current.x;
      const dy = touch.clientY - touchStartPosition.current.y;
      const moveDistance = Math.sqrt(dx * dx + dy * dy);
      
      // If movement exceeds threshold, cancel any pending selection
      if (moveDistance > 10) {
        clearTimeout(longPressTimer.current);
      }
    }

    if (action) {
      // If we're in the middle of a rectangle transformation,
      // convert touch move to mouse move
      const touch = touches[0];
      const mouseEvent = new MouseEvent('mousemove', {
        clientX: touch.clientX,
        clientY: touch.clientY,
        bubbles: true,
        cancelable: true,
      });

      // Dispatch the mouse move event
      document.dispatchEvent(mouseEvent);
      return;
    }

    // Update last touch info for gesture detection
    const newTouches = new Map();
    touches.forEach(t => {
      newTouches.set(t.identifier, {
        clientX: t.clientX,
        clientY: t.clientY,
        timeStamp: e.timeStamp
      });
    });
    setLastTouchInfo(prev => ({
      touches: newTouches,
      timeStamp: e.timeStamp,
      prevTouches: prev?.touches
    }));

    if (touches.length === 2) {
      // Handle pinch-zoom and rotation
      const currentDistance = getTouchDistance(touches[0], touches[1]);
      const currentAngle = getTouchAngle(touches[0], touches[1]);

      if (initialTouchDistance && initialTouchAngle) {
        // Enhanced sensitivity for mobile
        const sensitivity = isMobile ? 1.2 : 1.0;
        const scaleFactor = (currentDistance / initialTouchDistance) ** sensitivity;
        
        // Limit scale with smoother constraints for mobile
        const minScale = isMobile ? 0.2 : 0.1;
        const maxScale = isMobile ? 4 : 5;
        const newScale = Math.min(Math.max(initialScale * scaleFactor, minScale), maxScale);
        
        // Calculate rotation with dampening for more control
        const rotationDelta = (currentAngle - initialTouchAngle) * (isMobile ? 0.8 : 1.0);
        const newRotation = (initialRotation + rotationDelta) % 360;

        setViewport(prev => ({
          ...prev,
          scale: newScale
        }));
        setCanvasRotation(newRotation);
      }
    } else if (touches.length === 1 && isDraggingCanvas) {
      // Handle canvas panning with improved responsiveness on mobile
      const touch = touches[0];
      const dx = touch.clientX - lastMousePos.current.x;
      const dy = touch.clientY - lastMousePos.current.y;
      
      // Apply damping for smoother movement on mobile
      const dampingFactor = isMobile ? 1.0 : 1.0;
      
      setViewport(prev => ({
        ...prev,
        x: prev.x + (dx * dampingFactor),
        y: prev.y + (dy * dampingFactor)
      }));

      lastMousePos.current = {
        x: touch.clientX,
        y: touch.clientY
      };
    }
  }, [
    action,
    initialTouchDistance,
    initialTouchAngle,
    initialScale,
    initialRotation,
    isDraggingCanvas,
    isScrollingRectangle,
    isMobile
  ]);

  const handleTouchEnd = useCallback((e) => {
    // Clear any pending long press timer
    clearTimeout(longPressTimer.current);
    
    setSelectedOperation(null);

    // Check if this was a quick tap (less than 300ms)
    const touchDuration = e.timeStamp - touchStartTime.current;
    const isTap = touchDuration < 300;
    
    // Handle tap on rectangle for selection
    if (isTap && e.changedTouches.length === 1) {
      const touch = e.changedTouches[0];
      
      // Get element under touch point
      const element = document.elementFromPoint(touch.clientX, touch.clientY);
      
      if (element) {
        // Find closest rectangle container
        const rectElement = element.closest('[data-rect-id]');
        if (rectElement) {
          const rectId = parseInt(rectElement.getAttribute('data-rect-id'));
          
          // Check if touch didn't move much (within 10px)
          const dx = touch.clientX - touchStartPosition.current.x;
          const dy = touch.clientY - touchStartPosition.current.y;
          const moveDistance = Math.sqrt(dx * dx + dy * dy);
          
          if (moveDistance < 10) {
            // Handle tap selection
            setSelectedId(rectId);
            setSelectionOrder(prev => {
              const filtered = prev.filter(id => id !== rectId);
              return [rectId, ...filtered];
            });
          }
        } else if (element === canvasRef.current && !isScrollingRectangle) {
          // Tap on canvas background (not while scrolling)
          setSelectedId(null);
        }
      }
    }
    
    if (e.touches.length === 0) {
      // Reset all touch states
      setInitialTouchDistance(null);
      setInitialTouchAngle(null);
      setIsDraggingCanvas(false);
      setIsScrollingRectangle(false);
      setLastTouchInfo(null);
      touchStartPosition.current = { x: 0, y: 0 };
      activeRectangleRef.current = null;

      if (action) {
        // Trigger mouseup to end any active transformations
        const mouseEvent = new MouseEvent('mouseup', {
          bubbles: true,
          cancelable: true,
        });
        document.dispatchEvent(mouseEvent);
      }
    }
  }, [action, isScrollingRectangle]);

  const handleRectangleTouchStart = useCallback((e, id, actionType, corner) => {
    e.preventDefault();
    e.stopPropagation();
    
    setSelectedOperation(actionType);

    // Set mobile interaction flag
    isMobileInteraction.current = true;

    // Provide haptic feedback for control interactions if available
    if (navigator.vibrate) {
      navigator.vibrate(30);
    }

    // Cancel any canvas or scrolling modes
    setIsDraggingCanvas(false);
    setIsRotatingCanvas(false);
    setIsScrollingRectangle(false);

    const rect = rectangles.find(r => r.id === id);
    if (!rect) return;

    const touch = e.touches[0];
    const canvas = canvasRef.current.getBoundingClientRect();
    const touchX = touch.clientX - canvas.left;
    const touchY = touch.clientY - canvas.top;

    // Set selected ID and immediately start the transformation
    setSelectedId(id);
    setAction({ type: actionType, corner });
    
    // Bring this rectangle to front
    setSelectionOrder(prev => {
      const filtered = prev.filter(rectId => rectId !== id);
      return [id, ...filtered];
    });

    // Calculate and set the start point
    const canvasCenter = {
      x: window.innerWidth / 2,
      y: window.innerHeight / 2
    };

    const relativeToCenterX = touchX - canvasCenter.x;
    const relativeToCenterY = touchY - canvasCenter.y;

    const canvasRotationRad = (-canvasRotation * Math.PI) / 180;
    const rotatedX = (
      relativeToCenterX * Math.cos(canvasRotationRad) -
      relativeToCenterY * Math.sin(canvasRotationRad)
    );
    const rotatedY = (
      relativeToCenterX * Math.sin(canvasRotationRad) +
      relativeToCenterY * Math.cos(canvasRotationRad)
    );

    const worldStartX = (rotatedX / viewport.scale) - (viewport.x / viewport.scale) + canvasCenter.x;
    const worldStartY = (rotatedY / viewport.scale) - (viewport.y / viewport.scale) + canvasCenter.y;

    setStartPoint({ x: worldStartX, y: worldStartY });
    setrect({ ...rect });
    setLastAngle(rect.rotation);

    const handleMove = (moveEvent) => {
      if (!moveEvent.touches[0]) return;

      const currentTouch = moveEvent.touches[0];
      const currentTouchX = currentTouch.clientX - canvas.left;
      const currentTouchY = currentTouch.clientY - canvas.top;

      const relativeCurrentX = currentTouchX - canvasCenter.x;
      const relativeCurrentY = currentTouchY - canvasCenter.y;

      const rotatedCurrentX = (
        relativeCurrentX * Math.cos(canvasRotationRad) -
        relativeCurrentY * Math.sin(canvasRotationRad)
      );
      const rotatedCurrentY = (
        relativeCurrentX * Math.sin(canvasRotationRad) +
        relativeCurrentY * Math.cos(canvasRotationRad)
      );

      const worldCurrentX = (rotatedCurrentX / viewport.scale) - (viewport.x / viewport.scale) + canvasCenter.x;
      const worldCurrentY = (rotatedCurrentY / viewport.scale) - (viewport.y / viewport.scale) + canvasCenter.y;

      const deltaX = worldCurrentX - worldStartX;
      const deltaY = worldCurrentY - worldStartY;

      setRectangles(prevRects =>
        prevRects.map(r => {
          if (r.id !== id) return r;

          if (actionType === 'move') {
            return {
              ...r,
              x: rect.x + deltaX,
              y: rect.y + deltaY
            };
          }

          if (actionType === 'rotate') {
            const center = {
              x: rect.x + rect.width / 2,
              y: rect.y + rect.height / 2
            };

            const startAngle = Math.atan2(
              worldStartY - center.y,
              worldStartX - center.x
            );
            const currentAngle = Math.atan2(
              worldCurrentY - center.y,
              worldCurrentX - center.x
            );
            const deltaAngle = (currentAngle - startAngle) * (180 / Math.PI);

            return {
              ...r,
              rotation: (rect.rotation + deltaAngle) % 360
            };
          }

          if (actionType === 'resize') {
            const centerX = rect.x + rect.width / 2;
            const centerY = rect.y + rect.height / 2;
            const rectAngleRad = (rect.rotation * Math.PI) / 180;
            const cos = Math.cos(-rectAngleRad);
            const sin = Math.sin(-rectAngleRad);

            const relativeMouseX = worldCurrentX - centerX;
            const relativeMouseY = worldCurrentY - centerY;
            const rectLocalCurrentX = relativeMouseX * cos - relativeMouseY * sin;
            const rectLocalCurrentY = relativeMouseX * sin + relativeMouseY * cos;

            const relativeStartX = worldStartX - centerX;
            const relativeStartY = worldStartY - centerY;
            const rectLocalStartX = relativeStartX * cos - relativeStartY * sin;
            const rectLocalStartY = relativeStartX * sin + relativeStartY * cos;

            const deltaLocalX = rectLocalCurrentX - rectLocalStartX;
            const deltaLocalY = rectLocalCurrentY - rectLocalStartY;

            let newWidth = rect.width;
            let newHeight = rect.height;
            let newX = rect.x;
            let newY = rect.y;

            const scaleFactor = 1;

            switch (corner) {
              case 'topleft':
                newWidth = rect.width - deltaLocalX * scaleFactor;
                newHeight = rect.height - deltaLocalY * scaleFactor;
                break;
              case 'topright':
                newWidth = rect.width + deltaLocalX * scaleFactor;
                newHeight = rect.height - deltaLocalY * scaleFactor;
                break;
              case 'bottomleft':
                newWidth = rect.width - deltaLocalX * scaleFactor;
                newHeight = rect.height + deltaLocalY * scaleFactor;
                break;
              case 'bottomright':
                newWidth = rect.width + deltaLocalX * scaleFactor;
                newHeight = rect.height + deltaLocalY * scaleFactor;
                break;
            }

            newWidth = Math.max(50, newWidth);
            newHeight = Math.max(50, newHeight);

            const deltaWidth = newWidth - rect.width;
            const deltaHeight = newHeight - rect.height;

            newX = centerX - newWidth / 2;
            newY = centerY - newHeight / 2;

            return {
              ...r,
              width: newWidth,
              height: newHeight,
              x: newX,
              y: newY
            };
          }

          return r;
        })
      );
    };

    const handleEnd = () => {
      document.removeEventListener('touchmove', handleMove);
      document.removeEventListener('touchend', handleEnd);
      document.removeEventListener('touchcancel', handleEnd);
      setAction(null);
      setrect(null);
      setSelectedOperation(null);
    };

    document.addEventListener('touchmove', handleMove, { passive: false });
    document.addEventListener('touchend', handleEnd);
    document.addEventListener('touchcancel', handleEnd);
  }, [rectangles, viewport, canvasRotation]);

  // Update the canvas dragging handlers to handle right-click rotation
  const handleCanvasMouseDown = useCallback((e) => {
    // Get the mouse position relative to the canvas
    const canvas = canvasRef.current.getBoundingClientRect();
    const mouseX = e.clientX - canvas.left;
    const mouseY = e.clientY - canvas.top;

    // Check if the mouse is over any rectangle's content area
    const isOverRectangle = rectangles.some(rect => {
      // Convert to world coordinates
      const worldMouseX = (mouseX - viewport.x) / viewport.scale;
      const worldMouseY = (mouseY - viewport.y) / viewport.scale;

      // Calculate rectangle bounds including padding
      const padding = 20;
      const rectLeft = rect.x - padding;
      const rectTop = rect.y - padding;
      const rectRight = rect.x + rect.width + padding;
      const rectBottom = rect.y + rect.height + padding;

      // Check if point is within padded rectangle bounds
      return (
        worldMouseX >= rectLeft &&
        worldMouseX <= rectRight &&
        worldMouseY >= rectTop &&
        worldMouseY <= rectBottom
      );
    });

    // Only allow canvas transformations if no rectangle is selected AND we're not over a rectangle
    if (!selectedId && !isOverRectangle) {
      if (e.button === 0) { // Left click
        setIsDraggingCanvas(true);
        lastMousePos.current = { x: e.clientX, y: e.clientY };
      } else if (e.button === 2) { // Right click
        e.preventDefault();
        setIsRotatingCanvas(true);
        rotationStartPoint.current = { x: e.clientX, y: e.clientY };
      }
    }
  }, [rectangles, viewport, selectedId]);


  const handleCanvasMouseMove = useCallback((e) => {
    if (isDraggingCanvas) {
      const dx = e.clientX - lastMousePos.current.x;
      const dy = e.clientY - lastMousePos.current.y;

      setViewport(prev => ({
        ...prev,
        x: prev.x + dx,
        y: prev.y + dy
      }));

      lastMousePos.current = { x: e.clientX, y: e.clientY };
    } else if (isRotatingCanvas) {
      // Calculate the center of the viewport
      const centerX = window.innerWidth / 2;
      const centerY = window.innerHeight / 2;

      // Calculate angles from center to start and current points
      const startAngle = Math.atan2(
        rotationStartPoint.current.y - centerY,
        rotationStartPoint.current.x - centerX
      );
      const currentAngle = Math.atan2(
        e.clientY - centerY,
        e.clientX - centerX
      );

      // Calculate rotation delta in degrees
      const deltaRotation = (currentAngle - startAngle) * (180 / Math.PI);

      setCanvasRotation(prev => prev + deltaRotation);
      rotationStartPoint.current = { x: e.clientX, y: e.clientY };
    }
  }, [isDraggingCanvas, isRotatingCanvas]);

  const handleCanvasMouseUp = useCallback(() => {
    setIsDraggingCanvas(false);
    setIsRotatingCanvas(false);
  }, []);

  const handleContextMenu = useCallback((e) => {
    e.preventDefault();
  }, []);

  // Handle wheel - updated to allow text scrolling in rectangles
  const handleWheel = useCallback((e) => {
    if (!canvasRef.current) return;

    // Get mouse position
    const mouseX = e.clientX;
    const mouseY = e.clientY;

    // Check if the mouse is over any rectangle's content area
    const isOverRectangle = rectangles.some(rect => {
      const worldMouseX = (mouseX - viewport.x) / viewport.scale;
      const worldMouseY = (mouseY - viewport.y) / viewport.scale;

      const rectLeft = rect.x;
      const rectTop = rect.y;
      const rectRight = rect.x + rect.width;
      const rectBottom = rect.y + rect.height;

      return (
        worldMouseX >= rectLeft &&
        worldMouseX <= rectRight &&
        worldMouseY >= rectTop &&
        worldMouseY <= rectBottom
      );
    });

    // Only allow zooming if no rectangle is selected AND we're not over a rectangle
    if (!selectedId && !isOverRectangle) {
      e.preventDefault();

      const worldMouseX = (mouseX - viewport.x) / viewport.scale;
      const worldMouseY = (mouseY - viewport.y) / viewport.scale;

      const zoomAmount = -e.deltaY * 0.001;
      const newScale = viewport.scale * Math.exp(zoomAmount);
      const scale = Math.min(Math.max(newScale, 0.1), 5);

      setViewport(prev => ({
        scale,
        x: prev.x,
        y: prev.y
      }));
    }
  }, [rectangles, viewport, selectedId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) {
      // Add touch event listeners with appropriate passive settings
      canvas.addEventListener('touchstart', handleTouchStart, { passive: true });
      canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
      canvas.addEventListener('touchend', handleTouchEnd);
      canvas.addEventListener('touchcancel', handleTouchEnd);

      // Existing mouse event listeners
      canvas.addEventListener('wheel', handleWheel, { passive: false });
      canvas.addEventListener('mousedown', handleCanvasMouseDown);
      canvas.addEventListener('mousemove', handleCanvasMouseMove);
      canvas.addEventListener('contextmenu', handleContextMenu);
      document.addEventListener('mouseup', handleCanvasMouseUp);
      
      // Add additional mobile-specific event listeners for improved interactions
      if (isMobile) {
        // Prevent default on content scrollable areas to allow custom handling
        const contentAreas = canvas.querySelectorAll('.content-scrollable');
        contentAreas.forEach(area => {
          area.addEventListener('touchstart', (e) => {
            // Set the active rectangle for scrolling
            const rectElement = e.target.closest('[data-rect-id]');
            if (rectElement) {
              const rectId = parseInt(rectElement.getAttribute('data-rect-id'));
              activeRectangleRef.current = rectId;
              setIsScrollingRectangle(true);
            }
          }, { passive: true });
        });
      }

      return () => {
        // Remove touch event listeners
        canvas.removeEventListener('touchstart', handleTouchStart);
        canvas.removeEventListener('touchmove', handleTouchMove);
        canvas.removeEventListener('touchend', handleTouchEnd);
        canvas.removeEventListener('touchcancel', handleTouchEnd);

        // Remove existing mouse event listeners
        canvas.removeEventListener('wheel', handleWheel);
        canvas.removeEventListener('mousedown', handleCanvasMouseDown);
        canvas.removeEventListener('mousemove', handleCanvasMouseMove);
        canvas.removeEventListener('contextmenu', handleContextMenu);
        document.removeEventListener('mouseup', handleCanvasMouseUp);
        
        clearTimeout(longPressTimer.current);
        clearTimeout(window.scrollTimer);
        clearTimeout(window.scrollEndTimer);
};
}
}, [
handleWheel,
handleCanvasMouseDown,
handleCanvasMouseMove,
handleCanvasMouseUp,
handleTouchStart,
handleTouchMove,
handleTouchEnd,
isMobile
]);

// Rectangle transformation handlers
const handleCornerHover = (e, id, corner) => {
setHoveredCorner({ id, corner });
handleMouseEnter(e, id);
};

const handleCornerLeave = (e, id) => {
e?.stopPropagation?.(); // Make stopPropagation optional since we might not have an event
setHoveredCorner({ id: null, corner: null });
if (e) handleMouseLeave(e, id); // Only call handleMouseLeave if we have an event
};

const handleCornerTouchEnter = (id, corner) => {
setHoveredCorner({ id, corner });
};

const handleCornerTouchLeave = () => {
setHoveredCorner({ id: null, corner: null });
};

// Custom cursors
const cursors = {
rotate: `url("data:image/svg+xml;base64,${btoa(`
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2">
<path d="M21 12a9 9 0 11-3-6.7"/>
<path d="M22 4V10H16"/>
</svg>
`)}") 12 12, crosshair`,

scale: `url("data:image/svg+xml;base64,${btoa(`
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2">
<path d="M12 12 L20 4" stroke-linecap="round"/>
<path d="M20 4 L16 4" stroke-linecap="round"/>
<path d="M20 4 L20 8" stroke-linecap="round"/>
<path d="M12 12 L4 20" stroke-linecap="round"/>
<path d="M4 20 L8 20" stroke-linecap="round"/>
<path d="M4 20 L4 16" stroke-linecap="round"/>
</svg>
`)}") 12 12, nw-resize`
};

return (
<div>
{/* Mobile instruction overlay */}
{/* {isMobile && selectedId && (
  <div 
    className="fixed top-0 left-0 right-0 z-50 bg-black bg-opacity-60 text-white text-center p-2 text-sm"
    style={{
      opacity: 0.8,
      transition: 'opacity 0.3s ease',
      pointerEvents: 'none'
    }}
  >
    {action ? (
      action.type === 'move' ?   'Moving' : 
      action.type === 'resize' ? 'Resizing' :
      action.type === 'rotate' ? 'Rotating' : 
      'Tap corners to transform'
    ) : (
      'Tap page to select. Tap corners then drag canvas to resize/rotate/transform'
    )}
  </div>
)} */}

<div
  ref={canvasRef}
  className="fixed inset-0 bg-gray-100 touch-manipulation"
  style={{
    overflow: 'hidden',
    cursor: isDraggingCanvas ? 'grabbing' : isRotatingCanvas ? cursors.rotate : 'grab',
    touchAction: 'none', // Disable browser handling of all touch gestures
    WebkitTapHighlightColor: 'transparent', // Remove tap highlight on iOS
    WebkitTouchCallout: 'none', // Disable callout to copy image, etc on iOS
    WebkitUserSelect: 'none', // Disable selection on iOS
    userSelect: 'none' // Disable selection
  }}
  onTouchStart={handleTouchStart}
  onTouchMove={handleTouchMove}
  onTouchEnd={handleTouchEnd}
  onMouseDown={handleCanvasMouseDown}
  onMouseMove={handleCanvasMouseMove}
  onContextMenu={handleContextMenu}
>
  <div
    style={{
      position: 'absolute',
      transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale}) rotate(${canvasRotation}deg)`,
      transformOrigin: '50% 50%',
      width: '100%',
      height: '100%'
    }}
  >
    {rectangles.map((rect) => {
     const isSelected = selectedId === rect.id;
     const isPinned = rect.isPinned;
     const corners = ['topleft', 'topright', 'bottomleft', 'bottomright'];
     const padding = 20;

        return (
          <div
          key={rect.id}
          data-rect-id={rect.id}
          className="absolute"
          style={{
            left: `${rect.x - padding}px`,
            top: `${rect.y - padding}px`,
            width: `${rect.width + 2 * padding}px`,
            height: `${rect.height + 2 * padding + 32}px`,  // Add extra height for bottom margin
            transform: `rotate(${rect.rotation}deg)`,
            transformOrigin: `${rect.width / 2 + padding}px ${rect.height / 2 + padding}px`,
            zIndex: getZIndex(rect.id),
            pointerEvents: isPinned ? 'auto' : 'auto',
            touchAction: 'none'
          }}
            onMouseEnter={(e) => handleMouseEnter(e, rect.id)}
            onMouseLeave={(e) => handleMouseLeave(e, rect.id)}
            onTouchStart={(e) => {
              if (isPinned) return;
              e.stopPropagation();
              setSelectedId(rect.id);
              setSelectionOrder(prev => {
                const filtered = prev.filter(id => id !== rect.id);
                return [rect.id, ...filtered];
              });
            }}
          >
          {/* Add FlapHoverArea */}
          <FlapHoverArea rect={rect} isSelected={isSelected} />
          
          {/* Add TopFlap */}
          <TopFlap rect={rect} isSelected={isSelected} />

          <div
            className="absolute inset-0"
            style={{
              pointerEvents: 'none',
              cursor: 'default'
            }}
          />
          {/* Shadow and clipping container */}
          <div
              className="absolute"
              style={{
                left: `${padding}px`,
                top: `${padding}px`,
                width: `${rect.width}px`,
                height: `${rect.height}px`,
                boxShadow: rect.castShadow ? (
                  selectedId === rect.id
                    ? '8px 8px 16px rgba(0, 0, 0, 0.4)'
                    : getInterpolatedDepth(rect.id)
                ) : 'none',
              }}
            >
            {/* Main content with clipping */}
            <div
              className="absolute inset-0 overflow-hidden"
              style={{
                backgroundColor: getInterpolatedColor(rect.id),
                cursor: 'default',
                clipPath: hoveredCorner.id === rect.id ? (() => {
                  const size = 30;
                  const overlap = 30;
                  switch (hoveredCorner.corner) {
                    case 'topleft':
                      return `polygon(${size + overlap}px 0, 100% 0, 100% 100%, 0 100%, 0 ${size + overlap}px)`;
                    case 'topright':
                      return `polygon(0 0, calc(100% - ${size + overlap}px) 0, 100% ${size + overlap}px, 100% 100%, 0 100%)`;
                    case 'bottomleft':
                      return `polygon(0 0, 100% 0, 100% 100%, ${size + overlap}px 100%, 0 calc(100% - ${size + overlap}px))`;
                    case 'bottomright':
                      return `polygon(0 0, 100% 0, 100% calc(100% - ${size + overlap}px), calc(100% - ${size + overlap}px) 100%, 0 100%)`;
                    default:
                      return 'none';
                  }
                })() : 'none'
              }}
            ></div>

            {/* Folded corners */}
            {selectedId === rect.id && corners.map(corner => {
              const isHovered = hoveredCorner.id === rect.id && hoveredCorner.corner === corner;
              if (!isHovered) return null;

              const size = 20;
              let placement = {};
              let transform = 'rotate(0deg)';

              switch (corner) {
                case 'topleft':
                  placement = { top: 0, left: 0 };
                  break;
                case 'topright':
                  placement = { top: 0, right: 0 };
                  transform = 'rotate(90deg)';
                  break;
                case 'bottomleft':
                  placement = { bottom: 0, left: 0 };
                  transform = 'rotate(270deg)';
                  break;
                case 'bottomright':
                  placement = { bottom: 0, right: 0 };
                  transform = 'rotate(180deg)';
                  break;
              }

              return (
                <div
                  key={corner}
                  style={{
                    position: 'absolute',
                    width: `${size}px`,
                    height: `${size}px`,
                    ...placement,
                    pointerEvents: 'none',
                    transition: 'all 0.15s ease-in-out',
                    zIndex: 1
                  }}
                >
                  <div
                    style={{
                      position: 'absolute',
                      width: '100%',
                      height: '100%',
                      background: 'clear',
                      transform,
                      boxShadow: '2px 2px 4px rgba(0, 0, 0, 0.2)',
                      clipPath: 'polygon(0 0, 100% 0, 0 100%)'
                    }}
                  />
                </div>
              );
            })}
          </div>

          {/* Main rectangle content */}
          <div
            className="absolute overflow-hidden"
            style={{
              left: `${padding}px`,
              top: `${padding}px`,
              width: `${rect.width}px`,
              height: `${rect.height}px`,
              backgroundColor: getInterpolatedColor(rect.id),
              cursor: 'default',
              overflow: 'visible',
              clipPath: (hoveredCorner.id === rect.id && (isSelected || rect.isPinned)) ? (() => {
                const size = 20;
                const overlap = 10;
                switch (hoveredCorner.corner) {
                  case 'topleft':
                    return `polygon(${size + overlap}px 0, 100% 0, 100% 100%, 0 100%, 0 ${size + overlap}px)`;
                  case 'topright':
                    return `polygon(0 0, calc(100% - ${size + overlap}px) 0, 100% ${size + overlap}px, 100% 100%, 0 100%)`;
                  case 'bottomleft':
                    return `polygon(0 0, 100% 0, 100% 100%, ${size + overlap}px 100%, 0 calc(100% - ${size + overlap}px))`;
                  case 'bottomright':
                    return `polygon(0 0, 100% 0, 100% calc(100% - ${size + overlap}px), calc(100% - ${size + overlap}px) 100%, 0 100%)`;
                  default:
                    return 'none';
                }
              })() : 'none'
            }}
          >
          <RectangleContent
            rect={rect}
            scrollPositions={scrollPositions}
            setRectangles={setRectangles}
            setSelectedId={setSelectedId}
            setSelectionOrder={setSelectionOrder}
            canvasRotation={canvasRotation}
          />

            {/* Folded corners with enhanced shadow effect */}
            {(selectedId === rect.id || rect.isPinned) && corners.map(corner => (
                <div
                key={corner}
                style={{
                  position: 'absolute',
                  width: 0,
                  height: 0,
                  pointerEvents: 'none',
                  transition: 'all 0.15s ease-in-out',
                  opacity: hoveredCorner.id === rect.id && hoveredCorner.corner === corner ? 1 : 0,
                  ...(() => {
                    const size = 20;
                    const isHovered = hoveredCorner.id === rect.id && hoveredCorner.corner === corner;
                    const scale = isHovered ? 1.5 : 1;
                    const shadowIntensity = isHovered ? '0.3' : '0.2';

                    const baseStyle = {
                      transform: `scale(${scale})`,
                    };

                    switch (corner) {
                      case 'topleft':
                        return {
                          ...baseStyle,
                          top: 0,
                          left: 0,
                          borderTop: `${size}px solid white`,
                          borderRight: `${size}px solid transparent`,
                          boxShadow: `2px 2px 4px rgba(0, 0, 0, ${shadowIntensity})`,
                          transformOrigin: 'top left'
                        };
                      case 'topright':
                        return {
                          ...baseStyle,
                          top: 0,
                          right: 0,
                          borderTop: `${size}px solid white`,
                          borderLeft: `${size}px solid transparent`,
                          boxShadow: `-2px 2px 4px rgba(0, 0, 0, ${shadowIntensity})`,
                          transformOrigin: 'top right'
                        };
                      case 'bottomleft':
                        return {
                          ...baseStyle,
                          bottom: 0,
                          left: 0,
                          borderBottom: `${size}px solid white`,
                          borderRight: `${size}px solid transparent`,
                          boxShadow: `2px -2px 4px rgba(0, 0, 0, ${shadowIntensity})`,
                          transformOrigin: 'bottom left'
                        };
                      case 'bottomright':
                        return {
                          ...baseStyle,
                          bottom: 0,
                          right: 0,
                          borderBottom: `${size}px solid white`,
                          borderLeft: `${size}px solid transparent`,
                          boxShadow: `-2px -2px 4px rgba(0, 0, 0, ${shadowIntensity})`,
                          transformOrigin: 'bottom right'
                        };
                    }
                  })()
                }}
              />
            ))}
          </div>

          {/* Corner hover areas for pinned rectangles */}
          {rect.isPinned && corners.map(corner => {
            const x = padding + (corner.includes('right') ? rect.width : 0);
            const y = padding + (corner.includes('bottom') ? rect.height : 0);
            const touchSize = isMobile ? 60 : 50; // Larger touch target on mobile
            
            return (
              <div
                key={corner}
                style={{
                  position: 'absolute',
                  left: x - touchSize/2,
                  top: y - touchSize/2,
                  width: `${touchSize}px`,
                  height: `${touchSize}px`,
                  pointerEvents: 'auto',
                  zIndex: 20,
                  // Transparent hit area
                  background: 'rgba(0, 0, 0, 0.001)'
                }}
                onMouseEnter={(e) => handleCornerHover(e, rect.id, corner)}
                onMouseLeave={(e) => handleCornerLeave(e, rect.id)}
                onTouchStart={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  handleCornerTouchEnter(rect.id, corner);
                  // Brief delay to show visual feedback before starting action
                  setTimeout(() => {
                    handleRectangleTouchStart(e, rect.id, 'resize', corner);
                  }, 50);
                }}
              />
            );
          })}

          {/* Interactive areas */}
          {isSelected && !isPinned && (
            <>
              {corners.map(corner => {
                const x = padding + (corner.includes('right') ? rect.width : 0);
                const y = padding + (corner.includes('bottom') ? rect.height : 0);

                // Adjust the offsets for better spacing between controls
                const moveOffset = isMobile ? 40 : 30;
                const rotationOffset = isMobile ? 20 : 15;
                const scaleOffset = isMobile ? -8 : -5;

                const moveX = x + (corner.includes('right') ? -moveOffset : moveOffset);
                const moveY = y + (corner.includes('bottom') ? -moveOffset : moveOffset);

                const rotateX = x + (corner.includes('right') ? rotationOffset : -rotationOffset);
                const rotateY = y + (corner.includes('bottom') ? rotationOffset : -rotationOffset);

                const scaleX = x + (corner.includes('right') ? scaleOffset : -scaleOffset);
                const scaleY = y + (corner.includes('bottom') ? scaleOffset : -scaleOffset);

                return (
                  <React.Fragment key={corner}>
                    {/* Only show/enable the move control if no operation is selected or if move is the selected operation */}
                    {(!selectedOperation || selectedOperation === 'move') && (
                      <InteractiveArea
                        x={moveX}
                        y={moveY}
                        size={isMobile ? 60 : 50}
                        cursor='move'
                        onMouseDown={(e) => handleMouseDown(e, rect.id, 'move')}
                        onTouchStart={(e) => handleRectangleTouchStart(e, rect.id, 'move', corner)}
                        onMouseEnter={(e) => handleCornerHover(e, rect.id, corner)}
                        onMouseLeave={(e) => handleCornerLeave(e, rect.id)}
                        onTouchEnter={() => handleCornerTouchEnter(rect.id, corner)}
                        onTouchLeave={() => handleCornerTouchLeave()}
                      >
                        {isMobile && (
                          <div className="w-6 h-6 opacity-50 flex items-center justify-center">
                            <div className="w-2 h-2 bg-gray-400 rounded-full"></div>
                          </div>
                        )}
                      </InteractiveArea>
                    )}

                    {/* Only show/enable the rotate control if no operation is selected or if rotate is the selected operation */}
                    {(!selectedOperation || selectedOperation === 'rotate') && (
                      <InteractiveArea
                        x={rotateX}
                        y={rotateY}
                        size={isMobile ? 60 : 50}
                        cursor={cursors.rotate}
                        onMouseDown={(e) => handleMouseDown(e, rect.id, 'rotate')}
                        onTouchStart={(e) => handleRectangleTouchStart(e, rect.id, 'rotate', corner)}
                        onMouseEnter={(e) => handleCornerHover(e, rect.id, corner)}
                        onMouseLeave={(e) => handleCornerLeave(e, rect.id)}
                        onTouchEnter={() => handleCornerTouchEnter(rect.id, corner)}
                        onTouchLeave={() => handleCornerTouchLeave()}
                      >
                        {isMobile && (
                          <div className="w-6 h-6 opacity-50 flex items-center justify-center">
                            <div className="w-4 h-4 border-2 border-gray-400 rounded-full border-t-transparent"></div>
                          </div>
                        )}
                      </InteractiveArea>
                    )}

                    {/* Only show/enable the resize control if no operation is selected or if resize is the selected operation */}
                    {(!selectedOperation || selectedOperation === 'resize') && (
                      <InteractiveArea
                        x={scaleX}
                        y={scaleY}
                        size={isMobile ? 60 : 50}
                        cursor={cursors.scale}
                        onMouseDown={(e) => handleMouseDown(e, rect.id, 'resize', corner)}
                        onTouchStart={(e) => handleRectangleTouchStart(e, rect.id, 'resize', corner)}
                        onMouseEnter={(e) => handleCornerHover(e, rect.id, corner)}
                        onMouseLeave={(e) => handleCornerLeave(e, rect.id)}
                        onTouchEnter={() => handleCornerTouchEnter(rect.id, corner)}
                        onTouchLeave={() => handleCornerTouchLeave()}
                      >
                        {isMobile && (
                          <div className="w-6 h-6 opacity-50 flex items-center justify-center">
                            <div className="w-4 h-4 border-2 border-gray-400"></div>
                          </div>
                        )}
                      </InteractiveArea>
                    )}
                  </React.Fragment>
                );
              })}
            </>
          )}
        </div>
      );
    })}
  </div>
</div>
</div>
);
};

export default RectangleEditor;