import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import axios from 'axios';
import getStroke from "perfect-freehand";
import "./style.css";
import Switch from '@mui/material/Switch';
import { Link } from "react-router-dom";

const nearPoint = (x, y, x1, y1, name) => {
  return Math.abs(x - x1) < 5 && Math.abs(y - y1) < 5 ? name : null;
};

const onLine = (x1, y1, x2, y2, x, y, maxDistance = 1) => {
  const a = { x: x1, y: y1 };
  const b = { x: x2, y: y2 };
  const c = { x, y };
  const offset = distance(a, b) - (distance(a, c) + distance(b, c));
  return Math.abs(offset) < maxDistance ? "inside" : null;
};

const positionWithinElement = (x, y, element) => {
  const { type, x1, x2, y1, y2 } = element;
  switch (type) {
    case "line":
      const on = onLine(x1, y1, x2, y2, x, y);
      const start = nearPoint(x, y, x1, y1, "start");
      const end = nearPoint(x, y, x2, y2, "end");
      return start || end || on;
    case "rectangle":
      const topLeft = nearPoint(x, y, x1, y1, "tl");
      const topRight = nearPoint(x, y, x2, y1, "tr");
      const bottomLeft = nearPoint(x, y, x1, y2, "bl");
      const bottomRight = nearPoint(x, y, x2, y2, "br");
      const inside = x >= x1 && x <= x2 && y >= y1 && y <= y2 ? "inside" : null;
      return topLeft || topRight || bottomLeft || bottomRight || inside;
    case "pencil":
      const betweenAnyPoint = element.points.some((point, index) => {
        const nextPoint = element.points[index + 1];
        if (!nextPoint) return false;
        return onLine(point.x, point.y, nextPoint.x, nextPoint.y, x, y, 5) != null;
      });
      return betweenAnyPoint ? "inside" : null;
    case "text":
      return x >= x1 && x <= x2 && y >= y1 && y <= y2 ? "inside" : null;
    // case "entity":
    //   return x >= x1 && x <= x2 && y >= y1 && y <= y2 ? "inside" : null;
    default:
      throw new Error(`Type not recognised: ${type}`);
  }
};

const distance = (a, b) => Math.sqrt(Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2));

const getElementAtPosition = (x, y, elements) => {
  return elements
    .map(element => ({ ...element, position: positionWithinElement(x, y, element) }))
    .find(element => element.position !== null);
};

const adjustElementCoordinates = element => {
  const { type, x1, y1, x2, y2 } = element;
  if (type === "rectangle") {
    const minX = Math.min(x1, x2);
    const maxX = Math.max(x1, x2);
    const minY = Math.min(y1, y2);
    const maxY = Math.max(y1, y2);
    return { x1: minX, y1: minY, x2: maxX, y2: maxY };
  } else {
    if (x1 < x2 || (x1 === x2 && y1 < y2)) {
      return { x1, y1, x2, y2 };
    } else {
      return { x1: x2, y1: y2, x2: x1, y2: y1 };
    }
  }
};

const cursorForPosition = position => {
  switch (position) {
    case "tl":
    case "br":
    case "start":
    case "end":
      return "nwse-resize";
    case "tr":
    case "bl":
      return "nesw-resize";
    default:
      return "move";
  }
};

const resizedCoordinates = (clientX, clientY, position, coordinates) => {
  const { x1, y1, x2, y2 } = coordinates;
  switch (position) {
    case "tl":
    case "start":
      return { x1: clientX, y1: clientY, x2, y2 };
    case "tr":
      return { x1, y1: clientY, x2: clientX, y2 };
    case "bl":
      return { x1: clientX, y1, x2, y2: clientY };
    case "br":
    case "end":
      return { x1, y1, x2: clientX, y2: clientY };
    default:
      return null; //should not really get here...
  }
};

const useHistory = initialState => {
  const [index, setIndex] = useState(0);
  const [history, setHistory] = useState([ initialState]);

  const setState = (action, overwrite = false) => {
    const newState = typeof action === "function" ? action(history[index]) : action;
    
    if (overwrite) {
      const historyCopy = [...history];
      historyCopy[index] = newState;
      
      setHistory(historyCopy);
    } else {
      const updatedState = [...history].slice(0, index + 1);
      setHistory([...updatedState, newState]);
      
      setIndex(prevState => prevState + 1);
    }
  };

  const undo = () => index > 0 && setIndex(prevState => prevState - 1);
  const redo = () => index < history.length - 1 && setIndex(prevState => prevState + 1);
    
  
  return [history[index], setState, undo, redo];
  
};


const getSvgPathFromStroke = stroke => {
  if (!stroke.length) return "";

  const d = stroke.reduce(
    (acc, [x0, y0], i, arr) => {
      const [x1, y1] = arr[(i + 1) % arr.length];
      acc.push(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
      return acc;
    },
    ["M", ...stroke[0], "Q"]
  );

  d.push("Z");
  return d.join(" ");
};




const adjustmentRequired = type => ["line", "rectangle"].includes(type);

const usePressedKeys = () => {
  const [pressedKeys, setPressedKeys] = useState(new Set());

  useEffect(() => {
    const handleKeyDown = event => {
      setPressedKeys(prevKeys => new Set(prevKeys).add(event.key));
    };

    const handleKeyUp = event => {
      setPressedKeys(prevKeys => {
        const updatedKeys = new Set(prevKeys);
        updatedKeys.delete(event.key);
        return updatedKeys;
      });
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  return pressedKeys;
};



const App = ({ context }) => {
  const [elements, setElements, undo, redo] = useHistory([]);
  const [action, setAction] = useState("none");
  const [tool, setTool] = useState("selection");
  const [selectedElement, setSelectedElement] = useState(null);
  const [panOffset, setPanOffset] = React.useState({ x: 0, y: 0 });
  const [startPanMousePosition, setStartPanMousePosition] = React.useState({ x: 0, y: 0 });
  const textAreaRef = useRef();
  const pressedKeys = usePressedKeys();
  const [tabOrder, setTabOrder] = useState(0); // Step 1: Tab order state

  const [showDropdown, setShowDropdown] = useState(false); //file dropdown
  const [entities, setEntities] = useState([]);
  const [selectedEntityName, setSelectedEntityName] = useState(''); //select the name from DB list
  const canvasRef = useRef(null);

  const [isListOpen, setIsListOpen] = useState(true);  //list open/close
  const entityListRef = useRef(null);  //The event listener checks if the clicked target is outside the entity-list div using the listRef reference. If the click is detected outside the list, the list is closed (isListOpen is set to false).

  const [selectedEntityPosition, setSelectedEntityPosition] = useState({ x: 0, y: 0 });   //setting coordinates to move the DB entities on canvas
  // const text_array=[]
  const [text_array, setTextArray] = useState([]);
  const [val_array, setval_array]= useState([]);
  const [barcodeFlag, setbarcodeFlag] = useState(false);
  const [qrFlag, setqrFlag] = useState(false);

  const defaultCanvasWidth = 200; // Default canvas width in pixel
  const defaultCanvasHeight = 100; // Default canvas height in pixel
  const [canvasWidth, setCanvasWidth] = useState(defaultCanvasWidth);
  const [canvasHeight, setCanvasHeight] = useState(defaultCanvasHeight);
  const [selectedSize, setSelectedSize] = useState(`${defaultCanvasWidth}x${defaultCanvasHeight}`);
  const [fontSize, setFontSize] = useState(24);

 
 const [draggedName, setDraggedName] = useState('');
 const [draggedPosition, setDraggedPosition] = useState({ x: 0, y: 0 });
 
 const [isDialogOpen, setIsDialogOpen] = useState(false);
 const [selectedUnit, setSelectedUnit] = useState("mm");
 

 const labelUnitSelect = document.getElementById("label-unit");
 

 const handleImageClick = () => {
  setIsDialogOpen(true);
};


const labelSize = () => {
  const selectedValue = document.getElementById("label-unit").value;
  const selectedWidth = document.getElementById("label_width").value;
  const selectedHeight = document.getElementById("label_height").value;
  
  const canvas = canvasRef.current;


  // Update the canvas size based on the selected option
  console.log("getElementById value",selectedValue);
  console.log("getElementById width ",selectedWidth);
  console.log("getElementById height",selectedHeight);

  if (selectedValue === "mm") {
    
    canvas.width = selectedWidth / 0.264
    canvas.height = selectedHeight / 0.264
   
    console.log("width, height in mmmmmmmmmmm", canvas.width, canvas.height)
   
  } else if (selectedValue === "inch") {
    canvas.width = selectedWidth / 0.010416667  // Convert to millimeters and adjust for DPI
    canvas.height = selectedHeight / 0.010416667  // Convert to millimeters and adjust for DPI
    console.log("width, height in inchhhhhhhhhhhhh", canvas.width, canvas.height)
  } else if (selectedValue === "cm") {
    // You can add the conversion factor from cm to inches here if needed.
    canvas.width = selectedWidth /0.026458333
    canvas.height = selectedHeight /0.026458333
    console.log("width, height in ccccmmmmmmmmmmm", canvas.width, canvas.height)
  }
  else if (selectedValue === "Select unit") {
    
    canvas.width = selectedWidth 
    canvas.height = selectedHeight 
    console.log("width, height by default mmmmmmmmmmm", canvas.width, canvas.height)
  
  };
  
}

const handleUnitChange = (e) => {
  const newUnit = e.target.value;
  setSelectedUnit(newUnit);
  labelSize(newUnit); // Call labelSize with the new unit
};

useEffect(() => {
  labelSize(selectedUnit);
}, [selectedUnit]);

const handleOkButtonClick = () => {
  // Close the dialog
  setIsDialogOpen(false);
};
// const elementCoordinates = [];
const line_co_ords=[];
const rectangle_co_ords = [];
const text_co_ords = [];

  const drawElement = (context, element) => {

    let line_coordinates;
    let text_coordinates;
    let rect_coordinates;
    // let pen_coordinates
    // Check if element has a valid type
    if (!element.type) {
      console.error('Invalid element type:', element);
      return; // Exit early if the element has no type
    }

    switch (element.type) {
      case "line":
        context.beginPath();
        context.moveTo(element.x1, element.y1);
        context.lineTo(element.x2, element.y2);
        context.stroke();

        line_coordinates = {
          // type: "line",
          // start: { x: element.x1, y: element.y1 },
          // end: { x: element.x2, y: element.y2 }
          x1: element.x1, 
          y1: element.y1,
          x2: element.x2,
          y2: element.y2
        };

        // console.log(`Type: ${line_coordinates.type}`);
        // console.log(`Start Point: x=${line_coordinates.start.x}, y=${line_coordinates.start.y}`);
        // console.log(`End Point: x=${line_coordinates.end.x}, y=${line_coordinates.end.y}`);
        console.log(`x1 = ${line_coordinates.x1}, y1=${line_coordinates.y1},x2 = ${line_coordinates.x2}, y2=${line_coordinates.y2}`);
        line_co_ords.push(line_coordinates);
        break;

      case "rectangle":
        context.strokeRect(element.x1, element.y1, element.x2 - element.x1, element.y2 - element.y1);
        
        rect_coordinates = {
          // type: "rectangle",
          // start: { x: element.x1, y: element.y1 },
          // end: { x: element.x2, y: element.y2 }
          x1: element.x1, 
          y1: element.y1,
          x2: element.x2,
          y2: element.y2
        };

        console.log(`x1 = ${rect_coordinates.x1}, y1=${rect_coordinates.y1},x2 = ${rect_coordinates.x2}, y2=${rect_coordinates.y2}`);   /*you see backticks (`) surrounding the string. 
        These backticks are used to create a template literal, which is a more powerful way to create strings in JavaScript compared to traditional string concatenation.
        Within the template literal, you can embed expressions by using ${...}. In this case, coordinates.type is an expression that retrieves the type property from the coordinates object.
        */
        // console.log(`Start Point: x=${rect_coordinates.start.x}, y=${rect_coordinates.start.y}`);
        // console.log(`End Point: x=${rect_coordinates.end.x}, y=${rect_coordinates.end.y}`);
        rectangle_co_ords.push(rect_coordinates);
        break;

      // case "pencil":
      //   const stroke = getStroke(element.points);
      //   const path = new Path2D(getSvgPathFromStroke(stroke));
      //   context.fill(path);

      //   pen_coordinates = {
      //     type: "pencil",
      //     points: element.points
      //   };

      //   console.log(`Type: ${pen_coordinates.type}`);
      //   console.log(`points: ${pen_coordinates.points}`);
      //   break;

      case "text":
        context.textBaseline = "top";
        context.font = `${fontSize}px sans-serif`;
        context.fillText(element.text, element.x1, element.y1);
        
        text_coordinates = {
          // type: "text",
          // text: element.text,
          // position: { x: element.x1, y: element.y1 }
          x1: element.x1, 
          y1: element.y1,
        };

        // console.log(`Type: ${text_coordinates.type}`);
        // console.log(`position: x=${text_coordinates.position.x}, y=${text_coordinates.position.y}`);
        console.log(`x1 = ${text_coordinates.x1}, y1=${text_coordinates.y1}`);
        text_co_ords.push(text_coordinates); 
        break;
      default:
        throw new Error(`Type not recognised: ${element.type}`);
    }
    // elementCoordinates.push(coordinates)
      
      
     
  };

  const [image, setImage] = useState(null);
  
  const handleImageUpload = (event) => {
    console.log("Inside handleImageUpload()")
    const uploadedImage = event.target.files[0];
    setImage(uploadedImage);
    setIsDialogOpen(false);
  };
  
   useEffect(() => {
     uploadImage();
   });


  const uploadImage=() => {
    console.log("Inside uploadImage()");
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
  
    // Clear the canvas
    //ctx.clearRect(0, 0, canvas.width, canvas.height);
  
    // Draw the uploaded image on the canvas when the image state changes
    
    
    if (image) {
      const img = new Image();
      img.src = URL.createObjectURL(image);
      img.onload = () => {
        const logoSize = 64; // Size of the logo you want
        const aspectRatio = img.width / img.height;
        const targetWidth = logoSize;
        const targetHeight = targetWidth / aspectRatio;
  
        const x = (canvas.width - targetWidth) / 2; // Center the logo horizontally
        const y = (canvas.height - targetHeight) / 2; // Center the logo vertically
       
        ctx.drawImage(img, 10, 10, targetWidth, targetHeight);
       
      };
    }
  }
  


  const handleHeightChange = (e) => {
    const canvas = canvasRef.current;
    const selectedValue = document.getElementById("label-unit").value;
    console.log("selecteddddddddd value",selectedValue );
    
    let newHeight = parseInt(e.target.value, 10);

    if (selectedValue === "mm") {
      // canvas.width = canvas.width * mmToInch / dpiWidth; // Convert to inches and adjust for DPI
      // canvas.height = canvas.height * mmToInch / dpiHeight; // Convert to inches and adjust for DPI
      // canvas.width = canvasWidth / 0.264
      // canvas.height = canvasHeight / 0.264
      newHeight = newHeight / 0.264
     
      console.log(" height in mmmmmmmmmmm", newHeight)
     
    } else if (selectedValue === "inch") {
      // canvas.width = canvasWidth / 0.010416667  // Convert to millimeters and adjust for DPI
      canvas.height = canvasHeight / 0.010416667  // Convert to millimeters and adjust for DPI
      console.log(" height in inchhhhhhhhhhhhh", newHeight)
    } else if (selectedValue === "cm") {
      // You can add the conversion factor from cm to inches here if needed.
      // canvas.width = canvasWidth /0.026458333
      newHeight = newHeight /0.026458333
      console.log("height in ccccmmmmmmmmmmm", newHeight)
    }
    else if (selectedValue === "Select unit") {
      
      // canvas.width = canvasWidth 
      newHeight = newHeight
      console.log(" height by default mmmmmmmmmmm", newHeight)
    
    };

   setCanvasHeight(newHeight);

  };

  const handleWidthChange = (e) => {
    console.log("inside handleWidthCHnage*************")
    const canvas = canvasRef.current;
    const selectedValue = document.getElementById("label-unit").value;
    console.log("selecteddddddddd width value",selectedValue );
    let newWidth = parseInt(e.target.value, 10);

    if (selectedValue === "mm") {
      // canvas.width = canvas.width * mmToInch / dpiWidth; // Convert to inches and adjust for DPI
      // canvas.height = canvas.height * mmToInch / dpiHeight; // Convert to inches and adjust for DPI
      newWidth = newWidth / 0.264
      // canvas.height = canvasHeight / 0.264
     
      console.log("width in mmmmmmmmmmm", newWidth)
     
    } else if (selectedValue === "inch") {
      newWidth = newWidth / 0.010416667  // Convert to millimeters and adjust for DPI
      // canvas.height = canvasHeight / 0.010416667  // Convert to millimeters and adjust for DPI
      console.log("width in inchhhhhhhhhhhhh", newWidth)
    } else if (selectedValue === "cm") {
      // You can add the conversion factor from cm to inches here if needed.
      newWidth = newWidth /0.026458333
      // canvas.height = canvasHeight /0.026458333
      console.log("width in ccccmmmmmmmmmmm", newWidth)
    }
    else if (selectedValue === "Select unit") {
      
      newWidth = newWidth 
      // canvas.height = canvasHeight 
      console.log("width by default mmmmmmmmmmm", newWidth)
    
    };

    setCanvasWidth(newWidth);
    
   };

  const handleFontSizeChange = (event) => {
    const newFontSize = parseInt(event.target.value);
    setFontSize(newFontSize);
  
  };
 
  const handlebarcodeFlagToggle = () => {
    setbarcodeFlag(!barcodeFlag); // Toggle the flag value
    console.log("barcode flag******",(!barcodeFlag));
    
  };
  const handleQRcodeFlagToggle = () => {
    setqrFlag(!qrFlag); // Toggle the flag value
    console.log("barcode flag******",(!qrFlag));
    
  };
  
  // useEffect(() => {
  //       console.log("Entities updated in useEffect:", entities);
  //       }, [entities]);


  const handleDBImageClick = () => {
    console.log('handleDBImageClick triggered ************');
    console.log('Before state update - isListOpen:', isListOpen);

  if (isListOpen) {
    setIsListOpen(false);
    axios.get('http://127.0.0.1:4000/select_labels')
    .then(response => {
    const responseData = response.data.data; // Access the 'data' property
  console.log("resssssssssssponseeee",response)
  console.log("resssssssssssponseeee 2",responseData)
    // Assuming the response is an array of entities
    if (Array.isArray(responseData)) {
      setEntities(responseData);
      console.log("Entities updated:", responseData);
      
    } else {
      console.error('Invalid response format:', responseData);
      
    }
  })
  .catch(error => {
    console.error('Error fetching entities:', error);
  });
  }
  else{
    setIsListOpen(true);
    setEntities([]);
  }
console.log('isListOpen:', isListOpen);
console.log('After state update - isListOpen:', isListOpen);
  };

  
const handleEntityClick = (entityName) => {
    setSelectedEntityName(entityName);
    setIsListOpen(false);
    console.log("********selected Entity name*******",entityName);
    val_array.push(entityName)
    let currentY = 50;
    const entityPosition = { x: 50, y: currentY}; // Replace with actual coordinates
  setSelectedEntityPosition(entityPosition);
  currentY += 20;
  console.log("position......................",currentY);
  };

  const handlewtEntityClick = (entityWt) => {
    setSelectedEntityName(entityWt);
    setIsListOpen(false);
    console.log("selecteddddddddddddd nameeeeeeee",entityWt);
    val_array.push(entityWt)
  //   const entityPosition = { x: 120, y: 100 }; // Replace with actual coordinates
  // setSelectedEntityPosition(entityPosition);
  };

  const handleTDEntityClick = (entityTd) => {
    setSelectedEntityName(entityTd);
    setIsListOpen(false);
    console.log("selecteddddddddddddd nameeeeeeee",entityTd);
    val_array.push(entityTd)
  //   const entityPosition = { x: 140, y: 100 }; // Replace with actual coordinates
  // setSelectedEntityPosition(entityPosition);
  };

  const handleWeightDBImageClick = () => {
    console.log('handleWeightDBImageClick triggered');
    console.log('Before state update - isListOpen:', isListOpen);

  if (isListOpen) {
    setIsListOpen(false);
    axios.get('http://127.0.0.1:4000/select_units')
    .then(response => {
    const responseData = response.data.data; // Access the 'data' property
console.log("resssssssssssponseeee",response)
console.log("resssssssssssponseeee 2",responseData)
    // Assuming the response is an array of entities
    if (Array.isArray(responseData)) {
      setEntities(responseData);
      console.log("Entities updated:", responseData);
      
    } else {
      console.error('Invalid response format:', responseData);
      
    }
  })
  .catch(error => {
    console.error('Error fetching entities:', error);
  });
  }
  else{
    setIsListOpen(true);
    setEntities([]);
  }
console.log('isListOpen:', isListOpen);
console.log('After state update - isListOpen:', isListOpen);
  };



  const handleTimeDBImageClick = () => {
        console.log('handleTimeDBImageClick triggered');
    console.log('Before state update - isListOpen:', isListOpen);

  if (isListOpen) {
    setIsListOpen(false);
    axios.get('http://127.0.0.1:4000/select_date_time')
    .then(response => {
    const responseData = response.data.data; // Access the 'data' property
console.log("resssssssssssponseeee",response)
console.log("resssssssssssponseeee 2",responseData)
    // Assuming the response is an array of entities
    if (Array.isArray(responseData)) {
      setEntities(responseData);
      console.log("Entities updated:", responseData);
      
    } else {
      console.error('Invalid response format:', responseData);
      
    }
  })
  .catch(error => {
    console.error('Error fetching entities:', error);
  });
  }
  else{
    setIsListOpen(true);
    setEntities([]);
  }
console.log('isListOpen:', isListOpen);
console.log('After state update - isListOpen:', isListOpen);
  };



/*******************Toggle the dropdown visibility for file label open****************** */
  
  function toggleDropdown() {
    setShowDropdown((prevShowDropdown) => !prevShowDropdown);
    
  }
  
  // Close the dropdown if the user clicks outside of it
  function handleClickOutside(event) {
    if (!event.target.matches('.dropbtn')) {
      setShowDropdown(false);
    }
   
  }
  
  // Attach the event listener for clicks outside the dropdown
  React.useEffect(() => {
    document.addEventListener('click', handleClickOutside);
    return () => {
      document.removeEventListener('click', handleClickOutside);
    };
  }, []);
 
 /***************************************************************************** */ 

  useLayoutEffect(() => {

  const canvas = document.getElementById("canvas");
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, canvas.width, canvas.height);
  console.log("*****inside the useLayoutEffect*******")
   drawCanvas();
  
  context.save();
  context.translate(panOffset.x, panOffset.y);

  elements.forEach((element) => {
    if (element.type === "text" && element.fontSize) {
      context.font = `${element.fontSize}px sans-serif`;
    } else {
      context.font = `${fontSize}px sans-serif`;
    }
    drawElement(context, element);
  });
  context.restore();
}, [elements, action, panOffset]);


  useEffect(() => {
    const undoRedoFunction = event => {
      if ((event.metaKey || event.ctrlKey) && event.key === "z") {
        if (event.shiftKey) {
          redo();
        } else {
          undo();
        }
      }
    };

    document.addEventListener("keydown", undoRedoFunction);
    return () => {
      document.removeEventListener("keydown", undoRedoFunction);
    };
  }, [undo, redo]);

  useEffect(() => {
    const panFunction = event => {
      setPanOffset(prevState => ({
        x: prevState.x - event.deltaX,
        y: prevState.y - event.deltaY,
      }));
    };
  //Scroll 
    // document.addEventListener("wheel", panFunction);
    // return () => {
    //   document.removeEventListener("wheel", panFunction);
    // };
  }, []);

  useEffect(() => {
  const textArea = textAreaRef.current;
    if (action === "writing" && selectedElement) {
      setTimeout(() => {
        textArea.focus();
        textArea.value = selectedElement.text;
      }, 0);
      text_array.push(textArea);
    }
  }, [action, selectedElement]);



  const createElement = (id, x1, y1, x2, y2, type) => {
     switch (type) {
      case "line":
        return { id, x1, y1, x2, y2, type };
      case "rectangle":
        return { id, x1, y1, x2, y2, type };
      case "pencil":
        return { id, type, points: [{ x: x1, y: y1 }] };
      case "text":
        
        // Step 2: Include tabOrder for text elements
        const element = { id, type, x1, y1, x2, y2, text: "" };
        if (type === "text") {
          element.tabOrder = tabOrder;
          setTabOrder(prevTabOrder => prevTabOrder + 1); // Step 3: Increment tab order for the next text element
        }
        return element;
      
      default:
        throw new Error(`Type not recognised create element: ${type}`);
    }
  };

  const updateElement = (id, x1, y1, x2, y2, type, options) => {
    const elementsCopy = [...elements];

    switch (type) {
      case "line":
      case "rectangle":
        elementsCopy[id] = createElement(id, x1, y1, x2, y2, type);
        break;
      case "pencil":
        elementsCopy[id].points = [...elementsCopy[id].points, { x: x2, y: y2 }];
        break;
      case "text":
        const textWidth = document
          .getElementById("canvas")
          .getContext("2d")
          .measureText(options.text).width;
        const textHeight = 20;
        elementsCopy[id] = {
          ...createElement(id, x1, y1, x1 + textWidth, y1 + textHeight, type),
          text: options.text,
        };
        break;
      
      default:
        throw new Error(`Type not recognised in update element: ${type}`);
    }

    setElements(elementsCopy, true);
  };

  const getMouseCoordinates = (event) => {
    const canvas = canvasRef.current;
     const canvasRect = canvas.getBoundingClientRect();
    const clientX = event.clientX - canvasRect.left //panOffset.x;//186,194
    const clientY = event.clientY - canvasRect.top //panOffset.y;//179 ,156
    // console.log("x, y",clientX, clientY);
    //console.log("pan offffffsetttttttt",panOffset.x, panOffset.y )
    return { clientX, clientY };
    
  };

  const handleMouseDown = (event, canvasContext) => {
    canvasContext.save();

    if (action === "writing") return;
    /** extracts the clientX and clientY properties from the result of calling the getMouseCoordinates function with the event parameter.
     *  These properties represent the coordinates of the mouse pointer within the client area of the browser window. */
    const { clientX, clientY } = getMouseCoordinates(event); 

    if (event.button === 1 || pressedKeys.has(" ")) {
      /** checks if the mouse button pressed during the event is the middle button (button 1) or if the space key is pressed. 
       * If either of these conditions is true, the action is set to "panning". */
      setAction("panning");
      setStartPanMousePosition({ x: clientX, y: clientY }); //and the starting mouse position is stored for later use in panning the canvas
      return;
    }

    if (tool === "selection") {
      const element = getElementAtPosition(clientX, clientY, elements);
/***************************************expected to return an element that exists at the specified position.************************************************************************************* */

/******************************************************************************************************************** */
      if (element) {                /** checks if an element is returned. If an element exists at the specified position, it continues to the next steps. */
        if (element.type === "pencil") {
          /**calculates the x and y offsets between the clientX/clientY and the points of the element. 
           * These offsets are then stored in the state using the setSelectedElement function. 
           * Essentially, this is to be prepared for moving or editing a free-form drawing. */
          const xOffsets = element.points.map(point => clientX - point.x);
          const yOffsets = element.points.map(point => clientY - point.y);
          setSelectedElement({ ...element, xOffsets, yOffsets });
        } else {
          /**is not "pencil",  calculates the offset between the clientX/clientY and the starting coordinates of the element. 
           * This offset is then stored in the state using the setSelectedElement function. 
           * This can be used for moving or resizing other types of elements. */
          const offsetX = clientX - element.x1;
          const offsetY = clientY - element.y1;
          //console.log("when tool is selection in mouseDown, x , y =", offsetX, offsetY)
          setSelectedElement({ ...element, offsetX, offsetY });
        }  
        // setElements(prevState => prevState);
        if (element.position === "inside") {
          setAction("moving");
        } else {
          setAction("resizing");
        }
      }
    } else {
      /**a different tool is active, so generates a new element using the createElement function, 
       * assigns it a unique ID, and sets its initial position to the clientX and clientY coordinates. 
       * This new element is then added to the elements state array using the setElements function. */
      const id = elements.length;
      const element = createElement(id, clientX, clientY, clientX, clientY, tool);
      setElements(prevState => [...prevState, element]);
      setSelectedElement(element);

      setAction(tool === "text" ? "writing" : "drawing");
    }
  };

  
  const handleMouseMove = event => {
    const { clientX, clientY } = getMouseCoordinates(event);
    if (action === "panning") {
      const deltaX = clientX -startPanMousePosition.x;
      const deltaY = clientY -startPanMousePosition.y ;
      setPanOffset({
        x: panOffset.x + deltaX,
        y: panOffset.y + deltaY,
        
      }
      );
      // console.log("offfffffsettttt",panOffset.x, panOffset.y)
      return;
    }

    if (tool === "selection") {
      const element = getElementAtPosition(clientX, clientY, elements);
      event.target.style.cursor = element ? cursorForPosition(element.position) : "default";
    }

    if (action === "drawing") {
      const index = elements.length - 1;
      const { x1, y1 } = elements[index];
      updateElement(index, x1, y1, clientX, clientY, tool);
    } else if (action === "moving") {
      if (selectedElement.type === "pencil") {
        const newPoints = selectedElement.points.map((_, index) => ({
          x: clientX - selectedElement.xOffsets[index],
          y: clientY - selectedElement.yOffsets[index],
        }));
        const elementsCopy = [...elements];
        elementsCopy[selectedElement.id] = {
          ...elementsCopy[selectedElement.id],
          points: newPoints,
        };
        setElements(elementsCopy, true);
      } else {
        const { id, x1, x2, y1, y2, type, offsetX, offsetY } = selectedElement;
        const width = x2 - x1;
        const height = y2 - y1;
        const newX1 = clientX - offsetX;
        const newY1 = clientY - offsetY;
        const options = type === "text" ? { text: selectedElement.text } : {};
        updateElement(id, newX1, newY1, newX1 + width, newY1 + height, type, options);
      }
    } else if (action === "resizing") {
      const { id, type, position, ...coordinates } = selectedElement;
      const { x1, y1, x2, y2 } = resizedCoordinates(clientX, clientY, position, coordinates);
      updateElement(id, x1, y1, x2, y2, type);
    }
    /******************************************************************************************* */
   
  // } /***************************************************************************************** */
  };


  const handleMouseUp = event => {
    const { clientX, clientY } = getMouseCoordinates(event);
        
    if (selectedElement) {
      if (
        selectedElement.type === "text" &&
        clientX - selectedElement.offsetX === selectedElement.x1 &&
        clientY - selectedElement.offsetY === selectedElement.y1
      ) {
        setAction("writing");
        //console.log("handleMouseUp, for text, x , y  =", selectedElement.x1,selectedElement.y1)
        return;
      }

      const index = selectedElement.id;
      const { id, type } = elements[index];
      if ((action === "drawing" || action === "resizing") && adjustmentRequired(type)) {
        const { x1, y1, x2, y2 } = adjustElementCoordinates(elements[index]);
        updateElement(id, x1, y1, x2, y2, type);
        //console.log("handleMouseUp after update, for drawing and resize, x1 , y1 ,x2,y2 =", x1,y1,x2,y2)
      }
    }
    
    if (action === "writing") return;

    setAction("none");
    setSelectedElement(null);
  
  };

 
  const handleBlur = event => {
    const { id, x1, y1, type } = selectedElement;
    setAction("none");
    setSelectedElement(null);
    // Step 5: Update tab order when a text element is committed
    const newText = event.target.value;
    updateElement(id, x1, y1, null, null, type, { text: newText, tabOrder: selectedElement.tabOrder });
  };

  const  jsonData= (labelNameValue,labelAddValue) =>{
    const textareaValues = text_array.map(textArea => textArea.value);
      let data = {
        'label_text' : textareaValues, //text label array
        'label_values': val_array,  /// val array
        'is_barcode': barcodeFlag,
        'is_qrcode': qrFlag,
        'company_name':labelNameValue,
        'company_address':labelAddValue,
        // 'selected_element_co-ordinates':elementCoordinates
        'line_co_ordinates':line_co_ords,
        'rect_co_ordinates':rectangle_co_ords,
        'selected_element_co_text':text_co_ords,
        'selected_element_co_label':text_co_ords
       
      }

      return JSON.stringify(data)
  }

  const handleSaveImage = () => {
    const canvas = document.getElementById("canvas");
   const link = document.createElement("a"); // creating <a> element
    link.download = `${Date.now()}.jpg`; // set the file name for the downloaded image
    link.href = canvas.toDataURL(); // set the canvas data as link href value
    link.click(); // simulate clicking the link to download the image
    console.log("*************inside handleSaveImage*********");
    try{
    const labelNameValue = document.getElementById("label_name").value;
    const labelAddValue = document.getElementById("label_add").value;
    const post_data = jsonData(labelNameValue,labelAddValue, line_co_ords, rectangle_co_ords, text_co_ords)//give function call to json data 
    //to send post req to generate code

    console.log("Posttttttt Dataaaaa, resssssssssssponseeee",post_data)
     axios.post('http://127.0.0.1:4000/generate_zpl',post_data,{
      headers: {
        'Content-Type': 'application/json'
      }
    })
    .then(response => {
    // Access the 'data' property
    console.log(" resssssssssssponseeee",response)
})
    }
    catch(error){

    }

  };

  const serializeCanvas = (elements) => {
    return JSON.stringify(elements);
  };
  const deserializeCanvas = (data) => {
    return JSON.parse(data);
  };
  const handleSaveFile = () => {
    const canvas = document.getElementById("canvas");
    const serializedData = serializeCanvas(elements);
    const blob = new Blob([serializedData], { type: "application/json" });
    const link = document.createElement("a");
    link.download = `${Date.now()}.json`;
    link.href = URL.createObjectURL(blob);
    link.click();
  };
  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const data = e.target.result;
        const deserializedElements = deserializeCanvas(data);
        setElements(deserializedElements);
      };
      reader.readAsText(file);
    }
  };
  

// Step 6: Function to update tabOrder of the selected element

const handleTabOrderChange = event => {
  const newTabOrder = parseInt(event.target.value);
  if (!isNaN(newTabOrder)) {
    const updatedElements = elements.map(element => {
      if (element.id === selectedElement.id) {
        return { ...element, tabOrder: newTabOrder };
      }
      return element;
    });
    setElements(updatedElements, true);
  }
};


// Step 2: Add a useEffect to update tabOrder when undo or redo is called
useEffect(() => {
  setTabOrder(elements.length); // Update tabOrder when undo or redo is called
}, [elements]);

const drawCanvas = () => {
  const canvas = canvasRef.current;
  const context = canvas.getContext('2d');
  const selectedValue = document.getElementById("label-unit").value;
  
  let adjustedX
  let adjustedY
 
  context.font = '14px Arial';
  context.fillStyle = 'black';
  // ctx.fillText(`Selected Entity: ${selectedEntityName}`, 10, canvas.height - 20);
  /*
  let adjustedX = 160 + panOffset.x;
  let adjustedY = 30 + panOffset.y;
  */
  // let adjustedX = canvasWidth *0.5 + panOffset.x;
  // let adjustedY = canvasHeight *0.1  + panOffset.y;
  // console.log("adjustedX in mmmmmmmmmmm", adjustedX);
  // console.log("canvasWidth in mmmmmmmmmmm", canvasWidth);

  // /********************************************************* */
  if (selectedValue === "mm") {
    
     adjustedX = canvasWidth*2 + panOffset.x;
     adjustedY = canvasHeight *0.1  + panOffset.y;
    // canvas.height = canvasHeight / 0.264
    // adjustedX =newWidth
    // adjustedY = newHeight
      console.log("height in mmmmmmmmmmm", adjustedY)
      console.log("adjusted x in mmmmmmmmmmm", adjustedX)
      val_array.forEach((selectedEntityName, i) => {
        if(i === 0){
          adjustedY+=40 
          console.log("adjustedY in if loop", adjustedY)
          
        }
        else{
          adjustedY+=canvasHeight *0.5
          console.log("adjustedY in else loop", adjustedY)
          
        }
        context.fillText(` ${selectedEntityName}`,adjustedX, adjustedY);    
        })
   
  } else if (selectedValue === "inch") {
     adjustedX = canvasWidth *60 + panOffset.x;
     adjustedY = canvasHeight *0.1  + panOffset.y;
    // canvas.height = canvasHeight / 0.010416667  // Convert to millimeters and adjust for DPI
        val_array.forEach((selectedEntityName, i) => {
          if(i === 0){
            adjustedY+=50 
            console.log("adjustedY in if loop", adjustedY)
            
          }
        else{
          adjustedY+=canvasHeight *8
          console.log("adjustedY in else loop", adjustedY)
          
        }
        context.fillText(` ${selectedEntityName}`,adjustedX, adjustedY);    
        })
    
  } else if (selectedValue === "cm") {
    // You can add the conversion factor from cm to inches here if needed.
     adjustedX = canvasWidth*20 + panOffset.x;
     adjustedY = canvasHeight*0.1   + panOffset.y;
     console.log("adjustedX in for loop", adjustedX);
    // canvas.height = canvasHeight /0.026458333
        val_array.forEach((selectedEntityName, i) => {
          if(i === 0){
            adjustedY+=50 
            console.log("adjustedY in if loop", adjustedY)
            
          }
        else{
          adjustedY+=canvasHeight *3.8
          console.log("adjustedY in else loop", adjustedY)
          
        }
        context.fillText(` ${selectedEntityName}`,adjustedX, adjustedY);    
        })
  }
  else if (selectedValue === "Select unit") {
    
     adjustedX = canvasWidth *0.5 + panOffset.x;
     adjustedY = canvasHeight *0.1  + panOffset.y;
    // canvas.height = canvasHeight 
    
    console.log("width by default mmmmmmmmmmm", adjustedX)
  
  };
  /********************************************************* */
 // val_array.forEach(selectedEntityName => {
  //   adjustedY+=40
  //   console.log("adjustedY in for loop", adjustedY)
  //   context.fillText(` ${selectedEntityName}`,adjustedX, adjustedY);
        
  // })

  context.save();
};

//Call drawCanvas whenever the selected entity name changes
useEffect(() => {
  
  drawCanvas();
  
}, [selectedEntityName]);

/************************************************************************ */

  
    return (
    <body style={{background: "#98d4db"}}>
    <div className="container" style={{background: "#98d4db"}} >
      
      <section className="tools-board" >
        <div style={{height:"1.3cm"}}>
         
            <div className="dropdown">
              <button onClick={toggleDropdown} className="dropbtn">File</button>&emsp;
              <div id="myDropdown" className={`dropdown-content ${showDropdown ? 'show' : ''}`}>
                <a href="/" >New</a>
                {/* <a href="/label_Ui" >New</a> */}
                {/* replace with valid url of this page if integrated in other project to reload this page to have new client area or canvas */}
                <input
                    type="file"
                    id="fileInput"
                    onChange={handleFileUpload}
                    style={{ display: "none" }}
                  />
                  <label htmlFor="fileInput" style={{ cursor: "pointer", padding: "8px 12px" }}>
                    Open
                  </label>

                
                <a href="#home" onClick={handleSaveFile}>Save</a>
              </div>
            </div>

          <label className="title">View</label>&emsp;

          {/* <label class="title">Save File</label> */}
          <img width="24" height="24" padding="1" src="https://img.icons8.com/external-flaticons-flat-flat-icons/64/external-save-file-web-flaticons-flat-flat-icons.png" alt="external-save-file-web-flaticons-flat-flat-icons"  onClick={handleSaveImage} title="Click to Save Image"/>&emsp;
          <img width="16" height="16" src="https://img.icons8.com/tiny-color/16/undo.png" alt="undo" onClick={undo} title="Undo"/>&emsp;
          {/* <button onClick={undo}>Undo</button>&emsp; */}
          {/* <button onClick={redo}>Redo</button> */}
          <img width="16" height="16" src="https://img.icons8.com/tiny-color/16/redo.png" alt="redo" onClick={redo} title="Redo"/>
          {/* <hr style={{color:"black", width:"100%",height:"0.1px"}}></hr> */}
        </div>
        
        {/* <div className="row shape" style={{ position: "fixed", paddingTop: "1.2cm" }}> */}
        <div style={{height:"1.5cm"}}>
        <img width="24" height="27" src="https://img.icons8.com/external-itim2101-flat-itim2101/64/000000/external-printer-school-stationery-itim2101-flat-itim2101.png" alt="external-printer-school-stationery-itim2101-flat-itim2101"/>&emsp;&nbsp;
        <img width="36" height="26" src="https://img.icons8.com/glyph-neue/64/000000/barcode.png" alt="barcode"/>
        <Switch
        checked={barcodeFlag}
        onChange={handlebarcodeFlagToggle}
        color="primary"
        size="small"
        inputProps={{ 'aria-label': 'flag switch' }}
      />
      &nbsp;

        <img width="24" height="24" src="https://img.icons8.com/external-sbts2018-outline-sbts2018/58/external-qr-code-black-friday-5-basic-sbts2018-outline-sbts2018.png" alt="external-qr-code-black-friday-5-basic-sbts2018-outline-sbts2018"/>
        <Switch
        checked={qrFlag}
        onChange={handleQRcodeFlagToggle}
        color="primary"
        size="small"
        inputProps={{ 'aria-label': 'flag switch' }}
        />&nbsp;
        
          <img
            width="28"
            height="27"
            src="https://img.icons8.com/offices/30/database-export.png"
            alt="database-daily-export"
            id="handleDBImage"
            onClick={handleDBImageClick}
            style={{ cursor: 'pointer' }}
          />&emsp;&nbsp;
          {/* {isListOpen && ( */}
          <div className={`entity-list ${isListOpen ? 'open' : ''}`} >
              
              {entities.length> 0 && (
                <ul>
                  {entities.map(entity => (
                          <li key={entity.id} onClick={() => handleEntityClick(entity.name)} className={selectedEntityName === entity.name ? 'selected' : ''}>
                            {entity.name}
                          </li>
                        ))}
                 
                 </ul>
                  )
                  }
              
            </div>
         
            
        <img width="28" height="29" src="https://img.icons8.com/color/48/weight-kg.png" alt="weight-kg" onClick={handleWeightDBImageClick}
            style={{ cursor: 'pointer' }}/>&emsp;&nbsp;
            <div className={`wt-entity-list ${isListOpen ? 'open' : ''}`} >
              
              {entities.length> 0 && (
                <ul>
                    {/* {(() => {
                    const listItems = [];
                    for (let i = 0; i < entities.length; i++) {
                      const entity = entities[i];
                      listItems.push(<li key={entity.id}>{entity.name}</li>);
                    }
                    return listItems;
                  })()} */}

                  {entities.map(entity => (
                          <li key={entity.id} onClick={() => handlewtEntityClick(entity.wt)} className={selectedEntityName === entity.wt ? 'selected' : ''}>
                            {entity.wt}
                          </li>
                        ))}
                </ul>
              )}
            </div>
            
        <img width="28" height="28" src="https://img.icons8.com/offices/30/database-daily-export.png" alt="database-export"onClick={handleTimeDBImageClick}
            style={{ cursor: 'pointer' }}/>&emsp;&nbsp;

            <div className={`tm-entity-list ${isListOpen ? 'open' : ''}`} >
              
              {entities.length> 0 && (
                <ul>
                  
                  {entities.map(entity => (
                          <li key={entity.id} onClick={() => handleTDEntityClick(entity.date)} className={selectedEntityName === entity.date ? 'selected' : ''}>
                            {entity.date}
                          </li>
                        ))}
                 
                </ul>
              )
              }
            </div>
         
         <input
          type="radio"
          id="selection"
          checked={tool === "selection"}
          onChange={() => setTool("selection")}
        />
        <label htmlFor="selection">Selection</label>&emsp;
       

        <input type="radio" id="line" checked={tool === "line"} onChange={() => setTool("line")} />
        <img width="24" height="24" src="https://img.icons8.com/color/48/line.png" alt="line"/>&emsp;
        {/* <label htmlFor="line">Line</label>&emsp; */}
       

        <input
          type="radio"
          id="rectangle"
          checked={tool === "rectangle"}
          onChange={() => setTool("rectangle")}
        />
         <img width="26" height="23" src="https://img.icons8.com/fluency/48/rectangle-stroked.png" alt="rectangle-stroked"/>&emsp;
        {/* <span htmlFor="rectangle">Rectangle</span>&emsp; */}
       
        {/* <input
          type="radio"
          id="pencil"
          checked={tool === "pencil"}
          onChange={() => setTool("pencil")}
        />
        <img width="25" height="22" src="https://img.icons8.com/external-itim2101-flat-itim2101/64/external-pencil-school-stationery-itim2101-flat-itim2101.png" alt="external-pencil-school-stationery-itim2101-flat-itim2101"/>&emsp;
        <label htmlFor="pencil">Pencil</label>&emsp; */}
        
        <input type="radio" id="text" checked={tool === "text"} onChange={() => setTool("text")} />
        <img width="24" height="24" src="https://img.icons8.com/fluency/48/text-color.png" alt="text-color" />&emsp;&nbsp;
        {/* <label htmlFor="text">Text</label> */}
        
        <img width="30" height="30" src="https://img.icons8.com/color-glass/48/picture.png" alt="pic" onClick={handleImageClick}/>
        {isDialogOpen && (
        <div className="dialog">
        <input
         type="file"
        accept="image/*"
        onChange={handleImageUpload}
      />
       <button onClick={handleOkButtonClick}>OK</button>
        </div>
      )}
      {/*<hr style={{color:"#fff9f7", width:"100%"}}></hr>*/}
      </div>
      <div>
        <label htmlFor="label-size">Label Template Size : </label>
        
         <input type="number" id="label_width" name="label_width" placeholder="w"min="1"  onChange={handleWidthChange}  />x
         <input type="number" id="label_height" name="label_height" placeholder="h"min="1" onChange={handleHeightChange} />&nbsp;
     
      <select id="label-unit" name="label-unit" onChange={handleUnitChange} > 
        <option >Select unit</option> 
        <option value="mm">mm</option> 
	      <option value="inch">inch</option>
        <option value="cm">cm</option>
        </select>
        {/* <input type="text" id="label-size" name="label-size"/>&emsp; */}
        <label htmlFor="label_name"> Label Name : </label>
        <input type="text" id="label_name" name="label_name" size="10"/>&emsp;
        <label htmlFor="label_add"> Label Address : </label>
        <input type="text" id="label_add" name="label_add" size="10" />&emsp;

       {/*replace with desired url , otherwise gives error*/}
         {/* <Link to = '/admin-home'> 
        <button
        variant="contained"
        size="small"
        style={{backgroundColor:"#4169E1", color:"#FFFFFF"}}
        >Back to Home
        </button>
        </Link> */}

      </div>
      </section>
      {action === "writing" ? (
        <textarea
          ref={textAreaRef}
          onBlur={handleBlur}
          style={{
            position: "fixed",
            top: selectedElement.y1 + panOffset.y +155 ,
            left: selectedElement.x1 + panOffset.x+173,
            font: `${selectedElement.fontSize ||fontSize}px sans-serif`, // Use dynamic font size
            margin: 0,
            padding: 0,
            border: 0,
            outline: 0,
            resize: "auto",
            overflow: "hidden",
            whiteSpace: "pre",
            background: "transparent",
            zIndex: 2,
            width: 80, // Set the width to your desired value
            height: 40, // Set the height to your desired value
          }}
        />
      ) : null}
       
      
        <section className="drawing-board">
        <div>
          <label><b>Behaviour</b></label>
          {/* <hr style={{color:"#f4f0ec", width:"100%",height:"0.1px"}}></hr> */}

          <label htmlFor="tab-o">
            Tab Order:
             <input
                id="tab-o"
                type="number"
                size="10"
                // value={selectedElement.tabOrder}
                value={selectedElement?.type === "text" ? selectedElement.tabOrder : ""}
                onChange={handleTabOrderChange}
              />
            
          </label>
          {/* <hr style={{color:"#f4f0ec", width:"100%",height:"0.1px"}}></hr> */}
          
          <label><b>Misc</b></label>
          {/* <hr style={{color:"#f4f0ec", width:"100%",height:"0.1px"}}></hr> */}

          <label htmlFor="font">Font Size :&emsp;&nbsp;
          <input type="number" id="tab-o" name="font"
          value={fontSize}
          onChange={handleFontSizeChange}
         />
         </label>
          

          <label htmlFor="style">Style :&emsp;&nbsp;&emsp;&emsp;
          <input type="text" id="tab-o" name="style"/></label>

          <label htmlFor="H-R">Height-Ratio :
          <input type="number" id="tab-o" name="H-R"/></label>
	{/*<hr style={{color:"#f4f0ec", width:"590%",height:"0.1px"}}></hr>*/}
        </div> 
        
        <div>
        <canvas
          id="canvas"
          // width={window.innerWidth}
          ref={canvasRef}
          className="canvas_class"
          // height={window.innerHeight}
          width={canvasWidth} 
          height={canvasHeight}
          // onMouseDown={handleMouseDown}
          // onMouseDown={event => handleMouseDown(event, canvasRef.current.getContext('2d'))}
          // onMouseMove={handleMouseMove}
          // onMouseUp={handleMouseUp}
          // style={{ position: "absolute", zIndex: 1 }}
          
          onMouseDown={event => handleMouseDown(event, canvasRef.current.getContext('2d'))}
          onMouseMove={event => {
            const canvas = canvasRef.current;
            const canvasRect = canvas.getBoundingClientRect();
            // const mouseX = event.clientX - canvasRect.left;
            // const mouseY = event.clientY - canvasRect.top;
        
            // Check if the mouse is over the entity name
            // const entityNameRect = {
            //   x: 130 + panOffset.x,
            //   y: 50 + panOffset.y,
            //   width: canvasRef.current.getContext('2d').measureText(selectedEntityName).width,
            //   height: 16, // Adjust this value as needed
            // };
        
            // if (
            //   mouseX >= entityNameRect.x &&
            //   mouseX <= entityNameRect.x + entityNameRect.width &&
            //   mouseY >= entityNameRect.y &&
            //   mouseY <= entityNameRect.y + entityNameRect.height
            // ) {
            //   canvas.style.cursor = "move"; // Change the cursor to 'move'
            // } else {
            //   canvas.style.cursor = "default"; // Change the cursor back to 'default'
            // }
        
            handleMouseMove(event);
            // handleCanvasMouseMove();
          }}
          onMouseUp={handleMouseUp}
        //   onMouseUp={event => {handleMouseUp(event);
        //     handleCanvasMouseUp();
        //   }
        // }

          // onDragOver={(e) => e.preventDefault()}
          // onDrop={(e) => handleDrop(e)}
          // onMouseMove={handleCanvasMouseMove}
          // onMouseUp={handleCanvasMouseUp}
         
        >
        </canvas>
        </div>
        
        </section>
    </div>
  </body>
  );
};

export default App;