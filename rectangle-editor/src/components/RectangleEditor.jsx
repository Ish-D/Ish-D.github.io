import React, { useState, useRef, useEffect, useCallback, useLayoutEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import Frame from 'react-frame-component';

const RectangleEditor = () => {
  // Setup Stage
  const [selectedId, setSelectedId] = useState(null);
  const [action, setAction] = useState(null);
  const [startPoint, setStartPoint] = useState({ x: 0, y: 0 });
  const [rect, setrect] = useState(null);
  const [lastAngle, setLastAngle] = useState(0);
  const [hoveredCorner, setHoveredCorner] = useState({ id: null, corner: null });
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
  let initialWidth = window.innerWidth - (2 * 0.25 * window.innerWidth);
  let initialHeight = window.innerHeight - (2 * 0.1 * window.innerHeight);
  let font = 'Garamond'
  let fontSize = 16;

  const initialRect = {
    id: Date.now(),
    x: (window.outerWidth - initialWidth) / 2,
    y: (window.innerHeight - initialHeight) / 2,
    width: initialWidth,
    height: initialHeight,
    rotation: 0,
    color: `hsl(192, 100.00%, 99.00%)`,
    text: ""
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
        // For external URLs, create an iframe
        text = `<iframe src="${content.url}" style="width:100%; height:100%; border:none;"></iframe>`;
      } else if (content && content.file) {
        // For file content, fetch the file
        try {
          const response = await fetch(`/content/${content.file}`);
          text = await response.text();
        } catch (error) {
          console.error(`Error reading file ${content.file}:`, error);
        }
      }
  
      const newRect = {
        id: Date.now(),
        x: position.x,
        y: position.y,
        width: parseFloat(params.width) || 300,
        height: parseFloat(params.height) || 200,
        rotation: parseFloat(params.rotation) || -canvasRotation,
        color: `hsl(192, 100.00%, 99.00%)`,
        text
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
                <ReactMarkdown className="cursor-pointer">
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
                <ReactMarkdown className="cursor-pointer text-blue-600 hover:underline">
                  {linkText}
                </ReactMarkdown>
              </div>
            </div>
          );
        }
  
        // Regular text
        return (
          <div key={index} style={{ fontFamily: font, fontSize: fontSize }}>
            <ReactMarkdown>{part}</ReactMarkdown>
          </div>
        );
      });
    }, [rect, availableFunctions, setRectangles, setSelectedId, setSelectionOrder]);
  
    return (
      <div
        ref={contentRef}
        className="absolute inset-0 p-4 overflow-auto select-text"
        onClick={(e) => e.stopPropagation()}
        onScroll={handleScroll}
        style={{ cursor: 'text' }}
      >
        <div className="prose prose-sm max-w-none h-full">
          {renderContent(rect.text)}
        </div>
      </div>
    );
  });

  const getZIndex = (rectId) => {
    // Check if this is the most recently created rectangle
    if (rectId === Math.max(...rectangles.map(r => r.id))) {
      // Give it the highest possible z-index
      return selectionOrder.length + 1;
    }
    // Otherwise use selection order for z-index
    const index = selectionOrder.indexOf(rectId);
    return selectionOrder.length - index;
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

      // Check if the element under the cursor is NOT inside the current rectangle
      if (!underCursor ||
        !underCursor.closest(`[data-rect-id="${rectId}"]`)) {
        setSelectedId(null);
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
                  touchAction: 'none' // Prevent default touch actions
                }}
                onMouseEnter={(e) => handleMouseEnter(e, rect.id)}
                onMouseLeave={(e) => handleMouseLeave(e, rect.id)}
                onTouchStart={(e) => {
                  e.stopPropagation();
                  setSelectedId(rect.id);
                  setSelectionOrder(prev => {
                    const filtered = prev.filter(id => id !== rect.id);
                    return [rect.id, ...filtered];
                  });
                }}
              >
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
                      : '4px 4px 8px rgba(0, 0, 0, 0.2)',
                    /*
                    
                    */
                  }}
                >
                  {/* Main content with clipping */}
                  <div
                    className="absolute inset-0 overflow-hidden"
                    style={{
                      backgroundColor: rect.color,
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
                    backgroundColor: rect.color,
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
                  {selectedId === rect.id && corners.map(corner => (
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

                {/* Interactive areas */}
                {selectedId === rect.id && (
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