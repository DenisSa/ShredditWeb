export function generateRandomTextString() {
    const text = "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed non risus. Suspendisse lectus tortor, dignissim sit amet, adipiscing nec, ultricies sed, dolor.";
    const textArray = text.split(" ");
    const randomTextArray = [];
    for (let i = 0; i < 5; i++) {
        randomTextArray.push(textArray[Math.floor(Math.random() * textArray.length)]);
    }
    return randomTextArray.join(" ");
}

