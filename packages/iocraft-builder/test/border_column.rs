use iocraft::prelude::*;

fn main() {
    // Test case 1: Border on standalone box (WORKS)
    println!("Test 1: Border on standalone box");
    let standalone = element! {
        View(border_style: BorderStyle::Single, padding: 1) {
            Text(content: "Content")
        }
    };
    println!("{}", standalone.to_string());

    // Test case 2: Border on box inside column parent (FAILS)
    println!("\nTest 2: Border on box inside column parent");
    let with_column = element! {
        View(flex_direction: FlexDirection::Column) {
            Text(content: "Header")
            View(border_style: BorderStyle::Single, padding: 1) {
                Text(content: "Content")
            }
        }
    };
    println!("{}", with_column.to_string());

    // Test case 3: Multiple bordered boxes in column
    println!("\nTest 3: Multiple bordered boxes in column");
    let multiple = element! {
        View(flex_direction: FlexDirection::Column) {
            View(border_style: BorderStyle::Single, padding: 1) {
                Text(content: "First")
            }
            View(border_style: BorderStyle::Single, padding: 1) {
                Text(content: "Second")
            }
        }
    };
    println!("{}", multiple.to_string());
}
