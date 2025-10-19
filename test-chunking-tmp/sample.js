
/**
 * @pampa-tags: test, large-function, sample
 * @pampa-intent: Test function for chunking
 * @pampa-description: A large test function to demonstrate token-based chunking
 */
function testLargeFunction() {
    // This is a test function with multiple statements
    const data = [];
    
    for (let i = 0; i < 100; i++) {
        data.push({
            id: i,
            name: 'item' + i,
            value: Math.random()
        });
    }
    
    function processData() {
        return data.map(item => {
            return {
                ...item,
                processed: true
            };
        });
    }
    
    return processData();
}

class SampleClass {
    constructor() {
        this.value = 42;
    }
    
    method1() {
        return this.value * 2;
    }
    
    method2() {
        return this.value * 3;
    }
}
