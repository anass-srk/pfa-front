import React, { useState, useRef } from 'react';
import { Loader2 } from 'lucide-react';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { AnimatePresence, motion } from 'framer-motion';
import ProgressBar from './ProgressBar';
import UploadBox from './UploadStep';
import WebcamStep from './WebcamStep';
import ResultsStep from './ResultsStep';

const IDVerification = () => {
  const [step, setStep] = useState(1);
  const [frontID, setFrontID] = useState(null);
  const [backID, setBackID] = useState(null);
  const [selfieImage, setSelfieImage] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState(null);
  const [extractedData, setExtractedData] = useState(null);
  const videoRef = useRef(null);
  const streamRef = useRef(null);

  const handleFileUpload = (event, side) => {
    const file = event.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        if (side === 'front') {
          setFrontID(reader.result);
          setStep(2);
        } else {
          setBackID(reader.result);
          setStep(3);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const startWebcam = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      videoRef.current.srcObject = stream;
      streamRef.current = stream;
    } catch (err) {
      setError('Unable to access webcam. Please make sure you have granted permission.');
    }
  };

  const stopWebcam = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
    }
  };

  const captureImage = () => {
    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    canvas.getContext('2d').drawImage(videoRef.current, 0, 0);
    const image = canvas.toDataURL('image/jpeg');
    setSelfieImage(image);
    stopWebcam();
    setStep(4);
  };

  const convertBase64ToFile = (base64String, filename) => {
    const arr = base64String.split(',');
    const mime = arr[0].match(/:(.*?);/)[1];
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }
    return new File([u8arr], filename, { type: mime });
  };

  const processExtractedText = (textArray) => {
  const data = {
    first_name: '',
    last_name: '',
    date_of_birth: '',
    place_of_birth: '',
    expiry_date: '',
    card_number: '',
    verification_status: 'verified'
  };

  // Helper function to validate and format date
  const formatDate = (dateStr) => {
    const [day, month, year] = dateStr.split('.');
    return `${day.padStart(2, '0')}.${month.padStart(2, '0')}.${year}`;
  };

  // Helper function to check if string is a date in DD.MM.YYYY format
  const isDateFormat = (str) => {
    return /^\d{2}\.\d{2}\.\d{4}$/.test(str);
  };

  // Helper function to check if string is an ID number (1-2 capital letters followed by 6 numbers)
  const isIDNumber = (str) => {
    return /^[A-Z]{1,2}\d{6}$/.test(str);
  };

  let dates = [];

  textArray.forEach(item => {
    const text = item.text.trim();

    // Skip first two items (header texts)
    if (item.order <= 2) return;

    // Collect names (3rd and 4th items)
    if (item.order === 3) data.first_name = text;
    if (item.order === 4) data.last_name = text;

    // Check for dates
    if (isDateFormat(text)) {
      dates.push(text);
    }

    // Check for ID number pattern
    if (isIDNumber(text)) {
      data.card_number = text;
    }

    // Check for city (text after 'a' or 'à')
    if (text.startsWith('a ') || text.startsWith('à ')) {
      data.place_of_birth = text.substring(2); // Remove 'a ' or 'à ' prefix
    }
  });

  // Assign dates (first date is birth date, second is expiry)
  if (dates.length >= 2) {
    dates.sort(); // Sort dates to ensure birth date (earlier) comes first
    data.date_of_birth = formatDate(dates[0]);
    data.expiry_date = formatDate(dates[1]);
  }

  // Validate that we have all required fields
  const isValid = data.first_name && 
                 data.last_name && 
                 data.date_of_birth && 
                 data.place_of_birth && 
                 data.card_number;

  if (!isValid) {
    data.verification_status = 'incomplete';
  }

  return {
    success: isValid,
    data: {
      name: `${data.first_name} ${data.last_name}`,
      id_number: data.card_number,
      date_of_birth: data.date_of_birth,
      place_of_birth: data.place_of_birth,
      expiry_date: data.expiry_date,
      verification_status: data.verification_status
    }
  };
};

const processVerification = async () => {
  setIsProcessing(true);
  setError(null);
  
  try {
    // Face comparison API call
    const frontIDFile = convertBase64ToFile(frontID, 'front-id.jpg');
    const selfieFile = convertBase64ToFile(selfieImage, 'selfie.jpg');
    
    const faceComparisonData = new FormData();
    faceComparisonData.append('image1', frontIDFile);
    faceComparisonData.append('image2', selfieFile);

    const faceResponse = await fetch('http://localhost:8080/api/compare-faces', {
      method: 'POST',
      body: faceComparisonData
    });
    
    const faceResult = await faceResponse.json();
    
    if (!faceResult.success || !faceResult.match) {
      throw new Error('Face verification failed. Please try again.');
    }

    // Text extraction API call
    const textExtractionData = new FormData();
    textExtractionData.append('image', frontIDFile);

    const textResponse = await fetch('http://localhost:8080/api/extract-text', {
      method: 'POST',
      body: textExtractionData
    });

    const textResult = await textResponse.json();

    if (!textResult.success) {
      throw new Error('Failed to extract information from ID.');
    }

    // Process extracted text
    const processedResult = processExtractedText(textResult.extracted_text);
    
    if (!processedResult.success) {
      throw new Error('Could not extract all required information from ID. Please try again with a clearer image.');
    }

    setExtractedData(processedResult.data);
    setStep(5);
  } catch (err) {
    setError(err.message);
  } finally {
    setIsProcessing(false);
  }
};

  return (
    <div className="min-h-screen bg-gray-50 py-12">
      <div className="max-w-4xl mx-auto px-4">
        <h1 className="text-3xl font-bold text-center mb-8">Identity Verification</h1>
        
        <div className="bg-white rounded-2xl shadow-lg p-8 mb-8">
          <ProgressBar currentStep={step} />
          
          {error && (
            <Alert variant="destructive" className="mt-4">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          
          <AnimatePresence mode="wait">
            {step === 1 && (
              <motion.div
                key="step1"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="mt-8"
              >
                <UploadBox
                  onFileSelect={(e) => handleFileUpload(e, 'front')}
                  title="Upload ID Front"
                  subtitle="Please upload a clear image of your ID's front side"
                  image={frontID}
                />
              </motion.div>
            )}

            {step === 2 && (
              <motion.div
                key="step2"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="mt-8"
              >
                <UploadBox
                  onFileSelect={(e) => handleFileUpload(e, 'back')}
                  title="Upload ID Back"
                  subtitle="Please upload a clear image of your ID's back side"
                  image={backID}
                />
              </motion.div>
            )}

            {step === 3 && (
              <motion.div
                key="step3"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="mt-8"
              >
                <WebcamStep
                  videoRef={videoRef}
                  onCapture={captureImage}
                  onRetake={startWebcam}
                />
              </motion.div>
            )}

            {step === 4 && (
              <motion.div
                key="step4"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="mt-8"
              >
                <div className="text-center">
                  <div className="grid grid-cols-3 gap-4 mb-6">
                    <img src={frontID} alt="ID Front" className="border rounded-lg" />
                    <img src={backID} alt="ID Back" className="border rounded-lg" />
                    <img src={selfieImage} alt="Selfie" className="border rounded-lg" />
                  </div>
                  <button
                    onClick={processVerification}
                    disabled={isProcessing}
                    className="bg-blue-600 text-white px-6 py-2 rounded-lg flex items-center justify-center mx-auto hover:bg-blue-700 transition-colors"
                  >
                    {isProcessing ? (
                      <>
                        <Loader2 className="animate-spin mr-2" />
                        Verifying...
                      </>
                    ) : (
                      'Verify Identity'
                    )}
                  </button>
                </div>
              </motion.div>
            )}

            {step === 5 && extractedData && (
              <motion.div
                key="step5"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="mt-8"
              >
                <ResultsStep data={extractedData} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
};

export default IDVerification;