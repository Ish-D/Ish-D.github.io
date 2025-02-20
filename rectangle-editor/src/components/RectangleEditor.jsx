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

  const [isDraggingCanvas, setIsDraggingCanvas] = useState(false);
  const lastMousePos = useRef({ x: 0, y: 0 });

  const [canvasRotation, setCanvasRotation] = useState(0);
  const [isRotatingCanvas, setIsRotatingCanvas] = useState(false);
  const rotationStartPoint = useRef({ x: 0, y: 0 });

  const canvasRef = useRef(null);
  const scrollPositions = useRef({});

  const [viewport, setViewport] = useState({
    x: 0,
    y: 0,
    scale: 1
  });

  // Initialization
  let initialWidth = window.innerWidth - (2 * 0.3 * window.innerWidth);
  let initialHeight = window.innerHeight - (2 * 0.05 * window.innerHeight);
  let font = 'Palatino'
  let fontSize = 16;

  const initialRect = {
    id: Date.now(),
    x: (window.outerWidth - initialWidth) / 2,
    y: (window.innerHeight - initialHeight) / 2,
    width: initialWidth,
    height: initialHeight,
    rotation: 0,
    isPinned: false,
    color: `hsl(192, 100.00%, 99.00%)`,
    text: "",
    pageNumber: 0,
    margins: {
      top: 8,
      right: 8,
      bottom: 8,
      left: 8
    }
  };

  // Load initial content from file if path is provided
  useEffect(() => {
    const loadInitialContent = async () => {
      const response = await fetch(`/content/landing.md`);
      let text = await response.text();
      setRectangles(prev => [{
        ...prev[0],
        text: text
      }]);
    };
    loadInitialContent();
  }, []);

  // Initialize selection order with the initial rectangle
  const [rectangles, setRectangles] = useState([initialRect]);
  useEffect(() => {
    setSelectionOrder([initialRect.id]);
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
    onTouchEnter,  // New prop
    onTouchLeave   // New prop
  }) => {
    const touchSize = size;
    const [isTouch, setIsTouch] = React.useState(false);
    const [isActive, setIsActive] = React.useState(false);

    React.useEffect(() => {
      const isTouchDevice = (
        'ontouchstart' in window ||
        navigator.maxTouchPoints > 0 ||
        navigator.msMaxTouchPoints > 0 ||
        window.matchMedia('(pointer: coarse)').matches
      );
      setIsTouch(isTouchDevice);
    }, []);

    const handleTouchStart = (e) => {
      e.stopPropagation();
      e.preventDefault();
      setIsActive(true);
      onTouchStart?.(e);
      onTouchEnter?.(e); // Simulate hover on touch start
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
          background: 'rgba(0, 0, 0, 0.001)',
          borderRadius: '50%'
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
        // Get the relative offsets
        const dx = parseFloat(params.x) || 0;
        const dy = parseFloat(params.y) || 0;
        
        // Convert canvas rotation to radians
        const rotationRad = (-canvasRotation * Math.PI) / 180;
        
        // Apply rotation transformation to the relative offsets
        const rotatedDx = dx * Math.cos(rotationRad) - dy * Math.sin(rotationRad);
        const rotatedDy = dx * Math.sin(rotationRad) + dy * Math.cos(rotationRad);
        
        // Add rotated offsets to current rectangle position
        x = currentRect.x + rotatedDx;
        y = currentRect.y + rotatedDy;
      } else {
        // Absolute positioning
        x = parseFloat(params.x) || Math.random() * window.innerWidth;
        y = parseFloat(params.y) || Math.random() * window.innerHeight;
      }
  
      if (params.jitter !== 'false') {
        x += Math.random() * 50 - 25;
        y += Math.random() * 50 - 25;
      }
      
      return { x, y };
    };
  
  
    // Unified function to create new rectangles
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
    
      const newRect = {
        id: Date.now(),
        x: position.x,
        y: position.y,
        width: parseFloat(params.width) || 300,
        height: parseFloat(params.height) || 200,
        rotation: parseFloat(params.rotation) || -canvasRotation,
        color: `hsl(192, 100.00%, 99.00%)`,
        text,
        pageNumber: nextPageNumber,
        margins: {
          top: parseFloat(params.marginTop) || 5,
          right: parseFloat(params.marginRight) || 10,
          bottom: parseFloat(params.marginBottom) || 10,
          left: parseFloat(params.marginLeft) || 10
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
  
      // Match function calls, external links with parameters, and other text
      const parts = text.match(/(\[.*?\]\(function:\w+(?:\?[^\)]+)?\))|(\[.*?\]\(https?:\/\/[^?]+(?:\?rect=[^\)]+)?\))|([^\[]+)/g) || [];
  
      const markdownComponents = {
        // Handle div elements, preserving className and other attributes
        div: ({ node, className, children, ...props }) => {
          if (className?.includes('text-center')) {
            return (
              <div className={className} {...props}>
                <div className="markdown-content">
                  {children}
                </div>
              </div>
            );
          }
          return <div className={className} {...props}>{children}</div>;
        },
        
        // Headers with proper styling
        h1: ({ node, children }) => (
          <h1 className="mt-6 mb-4 text-4xl font-bold">{children}</h1>
        ),
        h2: ({ node, children }) => (
          <h2 className="mt-5 mb-3 text-3xl font-bold">{children}</h2>
        ),
        h3: ({ node, children }) => (
          <h3 className="mt-4 mb-2 text-2xl font-bold">{children}</h3>
        ),
        // Lists with proper alignment and nesting
        ul: ({ node, children }) => (
          <ul className="list-disc pl-6 my-3 text-left block w-full">{children}</ul>
        ),
        ol: ({ node, children }) => (
          <ol className="list-decimal pl-6 my-3 text-left block w-full">{children}</ol>
        ),
        li: ({ node, children }) => {
          // Check if children contains a list
          const hasNestedList = React.Children.toArray(children).some(
            child => React.isValidElement(child) && (child.type === 'ul' || child.type === 'ol')
          );
          return (
            <li className={`my-1 ${hasNestedList ? 'block' : ''}`}>{children}</li>
          );
        }
      };

      return parts.map((part, index) => {
        // Check for function call link with optional parameters
        const functionMatch = part.match(/\[(.*?)\]\(function:(\w+)(?:\?([^)]*))?\)/);
        if (functionMatch) {
          const [, linkText, functionName, params] = functionMatch;
          const functionToCall = availableFunctions[functionName];
  
          if (!functionToCall) {
            console.warn(`Function "${functionName}" not found in availableFunctions`);
            return null;
          }
  
          return (
            <div
              key={index}
              className="inline"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                functionToCall(params);
              }}
            >
              <div style={{ fontFamily: font, fontSize: fontSize }}>
                <ReactMarkdown 
                  remarkPlugins={[remarkGfm, remarkMath]}
                  rehypePlugins={[rehypeRaw, rehypeKatex]}
                  components={markdownComponents}
                  className="cursor-pointer markdown-wrapper"
                >
                  {linkText}
                </ReactMarkdown>
              </div>
            </div>
          );
        }
  
        // Check for external link with optional rectangle parameters
        const externalLinkMatch = part.match(/\[(.*?)\]\((https?:\/\/[^?]+)(?:\?rect=([^\)]+))?\)/);
        if (externalLinkMatch) {
          const [, linkText, url, rectParams] = externalLinkMatch;
          return (
            <div
              key={index}
              className="inline"
              onClick={async (e) => {
                e.preventDefault();
                e.stopPropagation();
                const params = rectParams ? parseParams(rectParams) : {};
                await createRectangle(params, rect, { url });
              }}
            >
              <div style={{ fontFamily: font, fontSize: fontSize }}>
                <ReactMarkdown
                  remarkPlugins={[remarkGfm, remarkMath]}
                  rehypePlugins={[rehypeRaw, rehypeKatex]}
                  components={markdownComponents}
                  className="cursor-pointer text-blue-600 hover:underline markdown-wrapper"
                >
                  {linkText}
                </ReactMarkdown>
              </div>
            </div>
          );
        }
  
        // Regular text
        return (
          <div key={index} style={{ fontFamily: font, fontSize: fontSize }} className="markdown-wrapper">
            <style>
              {`
                .markdown-wrapper .text-center .markdown-content > * {
                  margin-left: auto;
                  margin-right: auto;
                }
                .markdown-wrapper .text-center .markdown-content ul,
                .markdown-wrapper .text-center .markdown-content ol {
                  display: inline-block;
                  text-align: left;
                  width: auto;
                }
                .markdown-wrapper .text-center .markdown-content li > ul,
                .markdown-wrapper .text-center .markdown-content li > ol {
                  display: block;
                  margin-top: 0.5rem;
                  margin-bottom: 0.5rem;
                }
                .markdown-wrapper .text-center .markdown-content h1,
                .markdown-wrapper .text-center .markdown-content h2,
                .markdown-wrapper .text-center .markdown-content h3 {
                  text-align: center;
                }
              `}
            </style>
            <ReactMarkdown 
              remarkPlugins={[remarkGfm, remarkMath]}
              rehypePlugins={[rehypeRaw, rehypeKatex]}
              components={markdownComponents}
            >
              {part}
            </ReactMarkdown>
          </div>
        );
      });
    }, [rect, availableFunctions, setRectangles, setSelectedId, setSelectionOrder]);
  
    const parseContentWithMargins = useCallback((text) => {
      const margins = rect.margins || {
        top: 20,
        right: 20,
        bottom: 20,
        left: 20
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
  
  const marginMatch = line.match(/%{margin-(left|right|top|bottom)(-normal)?-start}/);
  
  if (marginMatch) {
    const position = marginMatch[1];
    const normalFlag = marginMatch[2];
    const key = normalFlag ? `${position}-normal` : position;
    
    let marginContent = [];
    let currentLine = lineIndex + 1;
    
    while (currentLine < lines.length && !lines[currentLine].includes(`%{margin-${position}${normalFlag || ''}-end}`)) {
      marginContent.push(lines[currentLine]);
      currentLine++;
    }
    
    marginContents[key].push({
      content: marginContent.join('\n').trim(),
      position: mainContentLines.length // Store current main content line number
    });
    
    lineIndex = currentLine + 1;
  } else {
    mainContentLines.push(line);
    lineIndex++;
  }
}

const mainContent = mainContentLines.join('\n').trim();
    
      const marginSizes = {
        left: (rect.width * (margins.left / 100)),
        right: (rect.width * (margins.right / 100)),
        top: (rect.height * (margins.top / 100)),
        bottom: (rect.height * (margins.bottom / 100))
      };

      const mainContentElement = (
        <div 
          style={{ 
            position: 'absolute',
            top: `${marginSizes.top}px`,
            left: `${marginSizes.left}px`,
            right: `${marginSizes.right}px`,
            bottom: `${marginSizes.bottom}px`,
            overflow: 'auto'  // Allow scrolling within the clipped area
          }}
        >
          {renderContent(mainContent)}
        </div>
      );

      const marginElements = Object.entries(marginContents).map(([positionKey, contents]) => 
        contents.map((content, idx) => {
          const [position, orientation] = positionKey.split('-');
          const isNormal = orientation === 'normal';
          const isSideMargin = position === 'left' || position === 'right';
          
          const lineHeight = 20;
          const verticalOffset = isSideMargin ? content.position * lineHeight : 0;
          
          const style = {
            position: 'absolute',
            margin: 0,
            padding: '8px',
            zIndex: 10,
            overflow: 'hidden',
            boxSizing: 'border-box'
          };
      
          const wrapperStyle = {
            width: '100%',
            height: isSideMargin ? '100%' : '100%', // Changed to 100% for side margins
            fontFamily: 'Palatino',
            fontSize: 16,
            display: 'flex',
            alignItems: isSideMargin ? 'flex-start' : 'center',
            justifyContent: isSideMargin ? 'flex-start' : 'center',
            position: 'relative',
            overflow: 'hidden' // Ensure content doesn't overflow
          };
      
          const contentStyle = {
            transform: !isNormal && position === 'left' ? 
              'rotate(-90deg) translate(30%, 0%)' : 
              !isNormal && position === 'right' ? 
              'rotate(90deg) translate(-30%, 0%)' : 
              'none',
            transformOrigin: !isNormal && position === 'left' ? 
              'left bottom' :
              !isNormal && position === 'right' ?
              'right bottom' :
              'top left',
            whiteSpace: isSideMargin && !isNormal ? 'nowrap' : 'pre-wrap',
            width: isSideMargin && !isNormal ? 'max-content' : '100%',
            maxWidth: isSideMargin && !isNormal ? 
              `${rect.height - margins.top - margins.bottom - 32}px` : 
              '100%',
            position: isSideMargin ? 'absolute' : 'static',
            top: isSideMargin ? `${verticalOffset}px` : 'auto',
            overflowWrap: 'break-word',
            // wordBreak: 'break-all',
            // For rotated text, we need to position it relative to its container
            ...(isSideMargin && !isNormal && {
              position: 'absolute',
              left: position === 'left' ? '50%' : undefined,
              right: position === 'right' ? '50%' : undefined,
              top: '50%'
            })
          };
      
          switch(position) {
            case 'left':
              style.left = 0;
              style.width = `${marginSizes.left}px`;
              style.top = `${marginSizes.top + 16}px`;
              style.height = `${rect.height - marginSizes.top - marginSizes.bottom - 32}px`;
              style.overflow = 'hidden';
              break;
            case 'right':
              style.right = 0;
              style.width = `${marginSizes.right}px`;
              style.top = `${marginSizes.top + 16}px`;
              style.height = `${rect.height - marginSizes.top - marginSizes.bottom - 32}px`;
              style.overflow = 'hidden';
              break;
            case 'top':
              style.top = 0;
              style.height = `${marginSizes.top}px`;
              style.left = `${marginSizes.left + 16}px`;
              style.right = `${marginSizes.right + 16}px`;
              break;
            case 'bottom':
              style.bottom = 0;
              style.height = `${marginSizes.bottom}px`;
              style.left = `${marginSizes.left + 16}px`;
              style.right = `${marginSizes.right + 16}px`;
              break;
          }
      
          // Get scroll position for this rectangle
          const scrollTop = scrollPositions.current[rect.id] || 0;
      
          // Add scroll adjustment for side margins
          if (isSideMargin) {
            contentStyle.transform += ` translateY(-${scrollTop}px)`;
          }
      
          return (
            <div
              key={`margin-${positionKey}-${idx}`}
              style={style}
            >
              <div style={wrapperStyle}>
                <div style={contentStyle}>
                  {isSideMargin && !isNormal ? content.content : renderContent(content.content)}
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
    }, [rect, renderContent]);

    const pageNumberDisplay = (
      <div
        style={{
          position: 'absolute',
          bottom: '8px',
          left: '16px',
          fontSize: 12,
          fontFamily: font,
          color: 'black',
          zIndex: 20,
          pointerEvents: 'none'
        }}
      >
        {(hoveredCorner.id === rect.id && hoveredCorner.corner === 'bottomleft') ?  String("") : String(rect.pageNumber).padStart(2, '0')}
      </div>
    );
  
    return (
      <div
        ref={contentRef}
        className="absolute inset-0 overflow-auto select-text"
        onClick={(e) => e.stopPropagation()}
        onScroll={(e) => {
          scrollPositions.current[rect.id] = e.target.scrollTop;
        }}
        style={{ cursor: 'text' }}
      >
          <div 
            className="prose prose-sm max-w-none h-full"
            style={{
              padding: rect.margins ? 
                `${rect.height * (rect.margins.top / 100)}px ${rect.width * (rect.margins.right / 100)}px ${rect.height * (rect.margins.bottom / 100)}px ${rect.width * (rect.margins.left / 100)}px` 
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
  const flapHeight = 50;
  const flapWidth = 140;
  const verticalOffset = -22;
  
  return (
    <div
      className={`
        flap-content 
        absolute 
        overflow-hidden
        transition-all 
        duration-300 
        ease-out
      `}
      style={{
        top: `-${verticalOffset + flapHeight}px`,
        left: '50%',
        transform: `translateX(-50%) perspective(1000px)`,
        width: `${flapWidth}px`,
        height: `${flapHeight}px`,
        zIndex: getZIndex(rect.id),
        visibility: isHovered ? 'visible' : 'visible', // Keep visible for animation
        opacity: isHovered ? 1 : 0,
      }}
      onMouseEnter={() => setHoveredFlap(rect.id)}
      onMouseLeave={(e) => {
        const relatedTarget = e.relatedTarget;
        if (!relatedTarget?.closest('.flap-hover-area')) {
          setHoveredFlap(null);
        }
      }}
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
            backgroundColor: `hsl(192, 100.00%, 99.00%)`,
            boxShadow: isHovered 
              ? '0 4px 6px rgba(0, 0, 0, 0.2)' 
              : '0 2px 4px rgba(0, 0, 0, 0.2)',
          }}
        >
          <div className="absolute inset-0 flex justify-center items-center gap-6">
            {[
              {
                key: 'pin',
                icon: rect.isPinned ? <PinOff size={20} /> : <Pin size={20} />,
                onClick: (e) => {
                  e.stopPropagation();
                  handlePin(rect.id);
                },
                style: {
                  color: rect.isPinned ? '#2563eb' : '#6b7280'
                },
                className: `
                  p-2 
                  rounded 
                  hover:bg-gray-100 
                  ${isHovered ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2'}
                `
              },
              {
                key: 'delete',
                icon: <Trash2 size={20} />,
                onClick: (e) => {
                  e.stopPropagation();
                  handleDelete(rect.id);
                },
                className: `
                  p-2 
                  rounded 
                  hover:bg-gray-100 
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
  const areaHeight = 50;
  const areaWidth = 160;
  const verticalOffset = 30;

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
    />
  );
};

const getZIndex = (rectId) => {
  const rect = rectangles.find(r => r.id === rectId);
  if (rect && pinnedRectangles.has(rectId)) {
    return 1000; // Pinned rectangles always on top
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

  // Parse the original color (assuming HSL format)
  const hslMatch = color1.match(/hsl\((\d+),\s*([\d.]+)%,\s*([\d.]+)%\)/);
  if (!hslMatch) return color1;

  // Convert HSL to RGB
  const rgbColor = hslToRgb(
    parseInt(hslMatch[1]),
    parseFloat(hslMatch[2]),
    parseFloat(hslMatch[3])
  );

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
  if (!rect) return "4px 4px 8px rgba(0, 0, 0, 0.2)";

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
      // If this deletion would leave us with no rectangles, restore initial state
      if (updatedRectangles.length === 0) {
        const newInitialRect = {
          ...initialRect,
          id: Date.now() // Ensure a new unique ID
        };
        // Load initial content
        fetch(`/content/landing.md`)
          .then(response => response.text())
          .then(text => {
            setRectangles([{
              ...newInitialRect,
              text: text
            }]);
          });
        setSelectionOrder([newInitialRect.id]);
        return [newInitialRect];
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

  const handleTouchStart = useCallback((e) => {
    if (!canvasRef.current) return;

    // Clear selection if touching the background directly
    if (e.target === canvasRef.current) {
      setSelectedId(null);
    }

    // If we're touching a rectangle or have one selected during a transformation, don't handle canvas interactions
    if (e.target.closest('[data-rect-id]') || action !== null) {
      return;
    }

    e.preventDefault();
    const touches = Array.from(e.touches);

    // Update active touches
    const newTouches = new Map();
    touches.forEach(t => {
      newTouches.set(t.identifier, {
        clientX: t.clientX,
        clientY: t.clientY
      });
    });
    setActiveTouches(newTouches);

    if (touches.length === 2) {
      const distance = getTouchDistance(touches[0], touches[1]);
      const angle = getTouchAngle(touches[0], touches[1]);
      setInitialTouchDistance(distance);
      setInitialTouchAngle(angle);
      setInitialScale(viewport.scale);
      setInitialRotation(canvasRotation);
    } else if (touches.length === 1) {
      lastMousePos.current = { x: touches[0].clientX, y: touches[0].clientY };
      setIsDraggingCanvas(true);
    }
  }, [viewport.scale, canvasRotation, action]);

  const handleTouchMove = useCallback((e) => {
    e.preventDefault();
    const touches = Array.from(e.touches);

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

    if (touches.length === 2) {
      // Handle pinch-zoom and rotation
      const currentDistance = getTouchDistance(touches[0], touches[1]);
      const currentAngle = getTouchAngle(touches[0], touches[1]);

      if (initialTouchDistance && initialTouchAngle) {
        const scaleFactor = currentDistance / initialTouchDistance;
        const newScale = Math.min(Math.max(initialScale * scaleFactor, 0.1), 5);
        const rotationDelta = currentAngle - initialTouchAngle;
        const newRotation = (initialRotation + rotationDelta) % 360;

        setViewport(prev => ({
          ...prev,
          scale: newScale
        }));
        setCanvasRotation(newRotation);
      }
    } else if (touches.length === 1 && isDraggingCanvas) {
      // Handle canvas panning
      const touch = touches[0];
      const dx = touch.clientX - lastMousePos.current.x;
      const dy = touch.clientY - lastMousePos.current.y;

      setViewport(prev => ({
        ...prev,
        x: prev.x + dx,
        y: prev.y + dy
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
    isDraggingCanvas
  ]);

  const handleTouchEnd = useCallback((e) => {
    if (e.touches.length === 0) {
      // Reset all touch states
      setInitialTouchDistance(null);
      setInitialTouchAngle(null);
      setIsDraggingCanvas(false);

      if (action) {
        // Trigger mouseup to end any active transformations
        const mouseEvent = new MouseEvent('mouseup', {
          bubbles: true,
          cancelable: true,
        });
        document.dispatchEvent(mouseEvent);
      }
    }
  }, [action]);

  const handleRectangleTouchStart = useCallback((e, id, actionType, corner) => {
    e.preventDefault();
    e.stopPropagation();

    setIsDraggingCanvas(false);
    setIsRotatingCanvas(false);

    const rect = rectangles.find(r => r.id === id);
    if (!rect) return;

    const touch = e.touches[0];
    const canvas = canvasRef.current.getBoundingClientRect();
    const touchX = touch.clientX - canvas.left;
    const touchY = touch.clientY - canvas.top;

    // Set selected ID and immediately start the transformation
    setSelectedId(id);
    setAction({ type: actionType, corner });

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
      // Add touch event listeners
      canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
      canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
      canvas.addEventListener('touchend', handleTouchEnd);
      canvas.addEventListener('touchcancel', handleTouchEnd);

      // Existing mouse event listeners...
      canvas.addEventListener('wheel', handleWheel, { passive: false });
      canvas.addEventListener('mousedown', handleCanvasMouseDown);
      canvas.addEventListener('mousemove', handleCanvasMouseMove);
      canvas.addEventListener('contextmenu', handleContextMenu);
      document.addEventListener('mouseup', handleCanvasMouseUp);

      return () => {
        // Remove touch event listeners
        canvas.removeEventListener('touchstart', handleTouchStart);
        canvas.removeEventListener('touchmove', handleTouchMove);
        canvas.removeEventListener('touchend', handleTouchEnd);
        canvas.removeEventListener('touchcancel', handleTouchEnd);

        // Remove existing mouse event listeners...
        canvas.removeEventListener('wheel', handleWheel);
        canvas.removeEventListener('mousedown', handleCanvasMouseDown);
        canvas.removeEventListener('mousemove', handleCanvasMouseMove);
        canvas.removeEventListener('contextmenu', handleContextMenu);
        document.removeEventListener('mouseup', handleCanvasMouseUp);
      };
    }
  }, [
    handleWheel,
    handleCanvasMouseDown,
    handleCanvasMouseMove,
    handleCanvasMouseUp,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd
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
      <div
        ref={canvasRef}
        className="fixed inset-0 bg-gray-100"
        style={{
          overflow: 'hidden',
          cursor: isDraggingCanvas ? 'grabbing' : isRotatingCanvas ? cursors.rotate : 'grab'
        }}
        onTouchStart={(e) => {
          // Only clear selection if touching the background directly
          if (e.target === e.currentTarget) {
            setSelectedId(null);
          }
          handleTouchStart(e);
        }}
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
                    height: `${rect.height + 2 * padding}px`,
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
                    boxShadow: selectedId === rect.id
                      ? '8px 8px 16px rgba(0, 0, 0, 0.4)'
                      : getInterpolatedDepth(rect.id),
                    /*
                    
                    */
                  }}
                >
                  {/* Main content with clipping */}
                  <div
                    className="absolute inset-0 overflow-hidden"
                    style={{
                      backgroundColor: getInterpolatedColor(rect.id),
                      cursor: 'default',
                      clipPath: hoveredCorner.id === rect.id ? (() => {
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
                  return (
                    <div
                      key={corner}
                      style={{
                        position: 'absolute',
                        left: x - 25,
                        top: y - 25,
                        width: '50px',
                        height: '50px',
                        pointerEvents: 'auto',
                        zIndex: 20
                      }}
                      onMouseEnter={(e) => handleCornerHover(e, rect.id, corner)}
                      onMouseLeave={(e) => handleCornerLeave(e, rect.id)}
                    />
                  );
                })}
                {/* Interactive areas */}
                {isSelected && !isPinned && (
                  <>
                    {corners.map(corner => {
                      const x = padding + (corner.includes('right') ? rect.width : 0);
                      const y = padding + (corner.includes('bottom') ? rect.height : 0);

                      const moveOffset = 30; // Increased from 30
                      const rotationOffset = 15; // Increased from 10
                      const scaleOffset = -5;

                      const moveX = x + (corner.includes('right') ? -moveOffset : moveOffset);
                      const moveY = y + (corner.includes('bottom') ? -moveOffset : moveOffset);

                      const rotateX = x + (corner.includes('right') ? rotationOffset : -rotationOffset);
                      const rotateY = y + (corner.includes('bottom') ? rotationOffset : -rotationOffset);

                      const scaleX = x + (corner.includes('right') ? scaleOffset : -scaleOffset);
                      const scaleY = y + (corner.includes('bottom') ? scaleOffset : -scaleOffset);

                      return (
                        <React.Fragment key={corner}>
                          <InteractiveArea
                            x={moveX}
                            y={moveY}
                            size={50}
                            cursor='move'
                            onMouseDown={(e) => handleMouseDown(e, rect.id, 'move')}
                            onTouchStart={(e) => handleRectangleTouchStart(e, rect.id, 'move', corner)}
                            onMouseEnter={(e) => handleCornerHover(e, rect.id, corner)}
                            onMouseLeave={(e) => handleCornerLeave(e, rect.id)}
                            onTouchEnter={() => handleCornerTouchEnter(rect.id, corner)}
                            onTouchLeave={() => handleCornerTouchLeave()}
                          />

                          <InteractiveArea
                            x={rotateX}
                            y={rotateY}
                            size={50}
                            cursor={cursors.rotate}
                            onMouseDown={(e) => handleMouseDown(e, rect.id, 'rotate')}
                            onTouchStart={(e) => handleRectangleTouchStart(e, rect.id, 'rotate', corner)}
                            onMouseEnter={(e) => handleCornerHover(e, rect.id, corner)}
                            onMouseLeave={(e) => handleCornerLeave(e, rect.id)}
                            onTouchEnter={() => handleCornerTouchEnter(rect.id, corner)}
                            onTouchLeave={() => handleCornerTouchLeave()}
                          />

                          <InteractiveArea
                            x={scaleX}
                            y={scaleY}
                            size={50}
                            cursor={cursors.scale}
                            onMouseDown={(e) => handleMouseDown(e, rect.id, 'resize', corner)}
                            onTouchStart={(e) => handleRectangleTouchStart(e, rect.id, 'resize', corner)}
                            onMouseEnter={(e) => handleCornerHover(e, rect.id, corner)}
                            onMouseLeave={(e) => handleCornerLeave(e, rect.id)}
                            onTouchEnter={() => handleCornerTouchEnter(rect.id, corner)}
                            onTouchLeave={() => handleCornerTouchLeave()}
                          />
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